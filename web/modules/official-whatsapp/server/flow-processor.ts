import { normalizeBrazilianPhone } from "@/lib/phone";
import { getFlow } from "./flows";
import { createFlowRun, findFlowRunByMessageId, markFlowRunStatus, setFlowRunFinalDestination, setFlowRunFinalMessageId } from "./flow-runs";
import { findTemplate } from "./templates";
import { sendWhatsAppTemplate } from "./send-template";
import { sendQuickReplyMessage } from "./send-interactive";
import { uploadMediaFromStorage } from "./meta-media";
import { attachMessageToFlowRun, logMessageAttempt } from "./messages-store";
import { markEventStatus } from "./hubla-events";
import { processQuickReplyClick } from "./quick-reply-processor";
import { buildTemplateComponents, missingRequiredVariables, missingTemplateMappings, renderTemplateText, type EventContext } from "./variable-resolver";
import { OfficialWhatsAppError, officialErrorCode, officialErrorMessage } from "./errors";
import { buildTrackedFinalLink } from "./tracked-links";
import { getFlowCta, getFlowStep, recordCtaClick } from "./analytics-attribution";
import { supabaseAdmin } from "@/lib/supabase";

// Envia o template inicial de um fluxo pra UM contato e cria o flow_run que vai permitir achar
// o contexto certo quando o clique chegar (fase B/C vão chamar isto em lote, um contato por vez).
export async function startFlow(input: { flowId: string; rawPhone: string; context: EventContext; source: string; sourceReference: string | null }) {
  const flow = await getFlow(input.flowId);
  if (!flow || !flow.active) throw new OfficialWhatsAppError("NO_AUTOMATION", "Fluxo não encontrado ou inativo.");

  let phone: string;
  try {
    phone = normalizeBrazilianPhone(input.rawPhone);
  } catch {
    throw new OfficialWhatsAppError("INVALID_PHONE", "Telefone inválido.");
  }

  const template = await findTemplate(flow.initial_template_name, flow.initial_template_language);
  const missingMappings = missingTemplateMappings({ mapping: flow.variable_mapping, parameterFormat: template.parameterFormat, header: template.variables.header, body: template.variables.body, namedHeader: template.namedVariables.header, namedBody: template.namedVariables.body, dynamicButtons: template.dynamicUrlButtonIndexes });
  if (missingMappings.length) throw new OfficialWhatsAppError("MISSING_TEMPLATE_VARIABLE", `Configure o mapeamento: ${missingMappings.join(", ")}.`);
  const missing = missingRequiredVariables(flow.variable_mapping, input.context);
  if (missing.length) throw new OfficialWhatsAppError("MISSING_TEMPLATE_VARIABLE", `Faltam variáveis: ${missing.join(", ")}`);

  const components = buildTemplateComponents(flow.variable_mapping, input.context, template.parameterFormat);
  const result = await sendWhatsAppTemplate({ phone, templateName: flow.initial_template_name, language: flow.initial_template_language, components });
  const initialStep = await getFlowStep(flow.id, "initial");
  let broadcastId: string | null = null;
  if (input.source === "broadcast" && input.sourceReference) {
    const { data } = await supabaseAdmin().from("official_broadcast_recipients").select("broadcast_id").eq("id", input.sourceReference).maybeSingle();
    broadcastId = data?.broadcast_id || null;
  }

  await logMessageAttempt({
    eventId: null, phone: result.phone, templateName: flow.initial_template_name, templateLanguage: flow.initial_template_language,
    status: "accepted", metaMessageId: result.messageId || null, requestPayload: result.requestPayload, responsePayload: result.response,
    attribution: { sourceType: input.source === "broadcast" ? "broadcast" : input.source === "external" ? "automation" : "manual", sourceId: input.sourceReference, flowId: flow.id, stepId: initialStep?.id || null, messageKey: "initial", templateId: flow.initial_template_name, broadcastId }
  });

  const run = await createFlowRun({
    flowId: flow.id, source: input.source, sourceReference: input.sourceReference,
    phone: result.phone, context: input.context, initialMetaMessageId: result.messageId || null
  });
  await attachMessageToFlowRun(result.messageId, run.id).catch((error) => console.error("[official-whatsapp] Falha ao vincular mensagem inicial ao fluxo:", error));
  return { flowRunId: run.id, phone: result.phone, messageId: result.messageId };
}

// Ponto de entrada único chamado pelo webhook. Tenta correlacionar pelo wamid da mensagem
// respondida (fluxo); se não achar flow_run, cai no comportamento antigo de Quick Reply avulso
// (payload + melhor esforço por telefone) — nada quebra pra quem não usa fluxo.
export async function processButtonClickEvent(eventId: string, click: { button: { payload: string }; from: string; context?: { id?: string } }) {
  const replyToMessageId = click.context?.id;
  const handledByFlow = replyToMessageId ? await processFlowClickByRepliedMessageId(eventId, replyToMessageId) : false;
  if (!handledByFlow) {
    await processQuickReplyClick(eventId, click.button.payload, click.from);
  }
}

// Retorna true se encontrou e processou via fluxo — o chamador cai no fallback antigo se false.
async function processFlowClickByRepliedMessageId(eventId: string, replyToMessageId: string): Promise<boolean> {
  const run = await findFlowRunByMessageId(replyToMessageId);
  if (!run) return false;

  await markFlowRunStatus(run.id, "clicked");
  const flow = await getFlow(run.flow_id);
  if (!flow) {
    await markFlowRunStatus(run.id, "failed");
    await markEventStatus(eventId, "failed", "Fluxo do flow_run não encontrado.", { quickReplyActionId: null });
    return true;
  }
  const action = flow.official_quick_reply_actions;
  const initialStep = await getFlowStep(flow.id, "initial");
  const cta = await getFlowCta(flow.id, "initial", "quick_reply");
  const admin = supabaseAdmin();
  const { data: originalMessage } = await admin.from("official_messages").select("id,broadcast_id,template_id").eq("meta_message_id", replyToMessageId).maybeSingle();
  await recordCtaClick({ clickId: eventId, flowRunId: run.id, flowId: flow.id, stepId: initialStep?.id || null, messageId: originalMessage?.id || null, templateId: originalMessage?.template_id || null, ctaId: cta?.id || null, broadcastId: originalMessage?.broadcast_id || null, phone: run.phone });

  const textResult = action.response_text ? renderTemplateText(action.response_text, run.context) : null;
  const captionResult = action.caption ? renderTemplateText(action.caption, run.context) : null;
  const missing = [...(textResult?.missing || []), ...(captionResult?.missing || [])];
  if (missing.length) {
    const summary = `MISSING_TEMPLATE_VARIABLE: ${missing.join(", ")}`;
    await logMessageAttempt({ eventId: null, phone: run.phone, status: "failed", error: summary }).catch(() => {});
    await markFlowRunStatus(run.id, "failed");
    await markEventStatus(eventId, "failed", summary, { quickReplyActionId: action.id });
    return true;
  }

  try {
    let mediaId: string | null = null;
    if (action.response_type !== "text" && action.media_bucket && action.media_path) {
      mediaId = await uploadMediaFromStorage(action.media_bucket, action.media_path, action.mime_type || "application/octet-stream", action.file_name || "arquivo");
    }
    let buttonUrlOverride: string | undefined;
    if (action.button_config?.type === "url") {
      await setFlowRunFinalDestination(run.id, action.button_config.url);
      buttonUrlOverride = buildTrackedFinalLink(run.id);
    }
    const result = await sendQuickReplyMessage(action, run.phone, { text: textResult?.text ?? null, caption: captionResult?.text ?? null, mediaId }, buttonUrlOverride);
    const followUpStep = await getFlowStep(flow.id, "follow_up");
    await logMessageAttempt({
      eventId: null, flowRunId: run.id, phone: result.phone, status: "accepted", metaMessageId: result.messageId || null,
      requestPayload: result.requestPayload, responsePayload: result.response,
      attribution: { sourceType: originalMessage?.broadcast_id ? "broadcast" : "automation", sourceId: originalMessage?.broadcast_id || null, flowId: flow.id, stepId: followUpStep?.id || null, messageKey: "follow_up", broadcastId: originalMessage?.broadcast_id || null }
    });
    await setFlowRunFinalMessageId(run.id, result.messageId || null).catch((error) => console.error("[official-whatsapp] Falha ao vincular mensagem final ao fluxo:", error));
    await markFlowRunStatus(run.id, "completed");
    await markEventStatus(eventId, "processed", null, { quickReplyActionId: action.id });
  } catch (error) {
    const summary = `${officialErrorCode(error)}: ${officialErrorMessage(error)}`.slice(0, 500);
    await logMessageAttempt({ eventId: null, phone: run.phone, status: "failed", error: summary }).catch(() => {});
    await markFlowRunStatus(run.id, "failed");
    await markEventStatus(eventId, "failed", summary, { quickReplyActionId: action.id });
  }
  return true;
}
