import { supabaseAdmin } from "@/lib/supabase";
import { findTemplate } from "./templates";
import { sendWhatsAppTemplate, type TemplateComponent } from "./send-template";
import { sendQuickReplyMessage } from "./send-interactive";
import { uploadMediaFromStorage } from "./meta-media";
import { buildTemplateComponents, renderTemplateText, type EventContext } from "./variable-resolver";
import type { QuickReplyAction } from "./quick-reply-actions";
import { automationStepButtonPayload, type ClickStep, type DelayStep, type DelayUnit, type FollowupStep } from "../automation-config";

const DELAY_UNIT_MS: Record<DelayUnit, number> = { minutes: 60_000, hours: 3_600_000, days: 86_400_000 };
export function delayToMs(step: DelayStep): number { return step.delayAmount * DELAY_UNIT_MS[step.delayUnit]; }

// A etapa que vem depois de "afterStepId" (ou a primeira etapa, se afterStepId for null) precisa
// ser buscada ao vivo — não pode vir só do snapshot congelado, que só conhece a etapa atual.
// Como cada elo só é congelado quando a mensagem anterior é enviada, uma edição das etapas só
// afeta elos ainda não congelados; um elo já "waiting" nunca muda depois de congelado.
export async function resolveNextStep(automationId: string, afterStepId: string | null): Promise<FollowupStep | null> {
  const admin = supabaseAdmin();
  const { data, error } = await admin.from("official_automations").select("followup_steps").eq("id", automationId).maybeSingle();
  if (error) throw error;
  const steps = ((data?.followup_steps as FollowupStep[] | null) || []);
  if (afterStepId === null) return steps[0] || null;
  const index = steps.findIndex((step) => step.id === afterStepId);
  return index === -1 ? null : (steps[index + 1] || null);
}

// O botão embutido na mensagem ATUAL sempre aponta para a PRÓXIMA etapa da cadeia — só existe
// quando essa próxima etapa é disparada por clique (uma etapa por atraso não precisa de botão).
export function buildNextStepButtonComponent(automationId: string, nextStep: FollowupStep | null): TemplateComponent | null {
  if (!nextStep || nextStep.triggerType !== "click") return null;
  return { type: "button", sub_type: "quick_reply", index: nextStep.triggerButtonIndex, parameters: [{ type: "payload", payload: automationStepButtonPayload(automationId, nextStep.id) }] };
}

// Etapa disparada por atraso: sem garantia de janela de atendimento aberta, então precisa ser
// um template aprovado — mesmo mecanismo da mensagem inicial (findTemplate + buildTemplateComponents).
export async function sendDelayTriggeredStep(input: {
  automationId: string;
  connectionId: string | null;
  phone: string;
  step: DelayStep;
  context: EventContext;
  nextStep: FollowupStep | null;
}) {
  const template = await findTemplate(input.step.templateName, input.step.templateLanguage, input.connectionId);
  const components: TemplateComponent[] = buildTemplateComponents(input.step.variableMapping, input.context, template.parameterFormat);
  const buttonComponent = buildNextStepButtonComponent(input.automationId, input.nextStep);
  if (buttonComponent) components.push(buttonComponent);
  return sendWhatsAppTemplate({ phone: input.phone, templateName: input.step.templateName, language: input.step.templateLanguage, components, connectionId: input.connectionId });
}

// Etapa disparada por clique: o clique reabre a janela de 24h, então pode ser mensagem livre —
// mesmo mecanismo que processAutomationButtonClick já usa hoje para a única segunda mensagem.
export async function sendClickTriggeredStep(input: {
  automationId: string;
  connectionId: string | null;
  phone: string;
  step: ClickStep;
  context: EventContext;
  nextStep: FollowupStep | null;
}) {
  const text = renderTemplateText(input.step.responseText || "", input.context);
  const caption = renderTemplateText(input.step.caption || "", input.context);
  if (text.missing.length || caption.missing.length) throw new Error("Faltam dados para personalizar esta etapa.");
  const mediaId = input.step.responseType !== "text"
    ? await uploadMediaFromStorage(input.step.mediaBucket!, input.step.mediaPath!, input.step.mimeType!, input.step.fileName || "arquivo", input.connectionId)
    : null;
  const nextPayload = input.nextStep ? automationStepButtonPayload(input.automationId, input.nextStep.id) : "";
  const buttonConfig: QuickReplyAction["button_config"] = input.step.buttonConfig?.type === "quick_reply"
    ? { type: "quick_reply", text: input.step.buttonConfig.text, payload: nextPayload }
    : input.step.buttonConfig?.type === "url" ? input.step.buttonConfig : null;
  const action: QuickReplyAction = {
    id: input.automationId, payload: nextPayload, button_label: null,
    response_type: input.step.responseType, response_text: input.step.responseText, caption: input.step.caption,
    media_bucket: input.step.mediaBucket, media_path: input.step.mediaPath, mime_type: input.step.mimeType, file_name: input.step.fileName,
    button_config: buttonConfig, active: true, created_at: "", updated_at: ""
  };
  return sendQuickReplyMessage(action, input.phone, { text: text.text, caption: caption.text, mediaId }, undefined, input.connectionId);
}
