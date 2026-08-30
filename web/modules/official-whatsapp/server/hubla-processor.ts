import { normalizeBrazilianPhone } from "@/lib/phone";
import { findActiveAutomation } from "./automations";
import { markEventStatus } from "./hubla-events";
import type { ParsedHublaEvent } from "./hubla-parser";
import { findTemplate } from "./templates";
import { sendWhatsAppTemplate, type TemplateComponent } from "./send-template";
import { logMessageAttempt } from "./messages-store";
import { buildTemplateComponents, missingRequiredVariables, type EventContext, type VariableMapping } from "./variable-resolver";
import { officialErrorCode, officialErrorMessage } from "./errors";
import { automationButtonPayload, followupConfigSchema } from "../automation-config";
import type { AutomationSnapshot } from "./automation-followup";

// Chamado via after() pelo webhook — a resposta HTTP já foi enviada à Hubla antes disso rodar.
// Fluxo: procura automação ativa -> normaliza telefone -> resolve variáveis -> envia via Meta -> loga.
export async function processHublaEvent(eventId: string, parsed: ParsedHublaEvent) {
  const automation = await findActiveAutomation(parsed.eventType, parsed.productId);
  if (!automation) {
    await markEventStatus(eventId, "ignored", null, { automationId: null });
    return;
  }

  let phone: string;
  try {
    phone = normalizeBrazilianPhone(parsed.customerPhone || "");
  } catch {
    await markEventStatus(eventId, "failed", "INVALID_PHONE: telefone do cliente ausente ou inválido no evento.", { automationId: automation.id });
    return;
  }

  // Busca o template ao vivo na Meta: garante que ainda está APPROVED e dá o parameter_format
  // (POSITIONAL/NAMED) atual — nunca assumimos o formato sem checar.
  let template;
  try {
    template = await findTemplate(automation.template_name, automation.template_language, automation.connection_id);
  } catch (error) {
    const summary = `${officialErrorCode(error)}: ${officialErrorMessage(error)}`.slice(0, 500);
    await markEventStatus(eventId, "failed", summary, { automationId: automation.id });
    return;
  }

  const context: EventContext = {
    customerName: parsed.customerName,
    productName: parsed.productName,
    customerEmail: parsed.customerEmail,
    customerPhone: parsed.customerPhone,
    amountCents: parsed.amountCents,
    paymentUrl: parsed.paymentUrl,
    accessUrl: parsed.accessUrl
  };
  const mapping = (automation.variable_mapping || {}) as VariableMapping;

  const missing = missingRequiredVariables(mapping, context);
  if (missing.length) {
    await markEventStatus(eventId, "failed", `MISSING_TEMPLATE_VARIABLE: ${missing.join(", ")}`, { automationId: automation.id });
    return;
  }

  const components: TemplateComponent[] = buildTemplateComponents(mapping, context, template.parameterFormat);
  let snapshot: AutomationSnapshot | null = null;
  try {
    if (automation.followup_mode && automation.followup_mode !== "legacy") {
    snapshot = { version: 1, mode: automation.followup_mode, context, config: null, triggerPayload: null };
    if (automation.followup_mode === "button") {
      const config = followupConfigSchema.parse(automation.followup_config);
      const button = template.components.find((item) => item.type === "BUTTONS")?.buttons?.[Number(config.triggerButtonIndex)];
      if (button?.type !== "QUICK_REPLY") { await markEventStatus(eventId, "failed", "O botão configurado não existe mais no modelo.", { automationId: automation.id }); return; }
      snapshot.config = config;
      snapshot.triggerPayload = automationButtonPayload(automation.id);
      components.push({ type: "button", sub_type: "quick_reply", index: config.triggerButtonIndex, parameters: [{ type: "payload", payload: snapshot.triggerPayload }] });
    }
    }
  } catch {
    await markEventStatus(eventId, "failed", "Revise a configuração da segunda mensagem nesta automação.", { automationId: automation.id });
    return;
  }

  try {
    const result = await sendWhatsAppTemplate({ phone, templateName: automation.template_name, language: automation.template_language, components, connectionId: automation.connection_id });
    await logMessageAttempt({
      eventId, phone: result.phone, templateName: automation.template_name, templateLanguage: automation.template_language,
      status: "accepted", metaMessageId: result.messageId || null, requestPayload: result.requestPayload, responsePayload: result.response, connectionId: result.connectionId,
      automationId: automation.id, automationSnapshot: snapshot,
      attribution: { sourceType: "automation", sourceId: automation.id, messageKey: "initial", templateId: automation.template_name, phoneNumberId: result.phoneNumberId }
    });
    await markEventStatus(eventId, "processed", null, { automationId: automation.id });
  } catch (error) {
    const summary = `${officialErrorCode(error)}: ${officialErrorMessage(error)}`.slice(0, 500);
    await logMessageAttempt({
      eventId, phone, templateName: automation.template_name, templateLanguage: automation.template_language,
      status: "failed", error: summary
    }).catch(() => {});
    await markEventStatus(eventId, "failed", summary, { automationId: automation.id });
  }
}
