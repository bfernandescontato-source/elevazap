import { normalizeBrazilianPhone } from "@/lib/phone";
import { findActiveAutomation } from "./automations";
import { markEventStatus } from "./hubla-events";
import type { ParsedHublaEvent } from "./hubla-parser";
import { findTemplate } from "./templates";
import { sendWhatsAppTemplate } from "./send-template";
import { logMessageAttempt } from "./messages-store";
import { buildTemplateComponents, missingRequiredVariables, type EventContext, type VariableMapping } from "./variable-resolver";
import { officialErrorCode, officialErrorMessage } from "./errors";

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
    template = await findTemplate(automation.template_name, automation.template_language);
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

  const components = buildTemplateComponents(mapping, context, template.parameterFormat);

  try {
    const result = await sendWhatsAppTemplate({ phone, templateName: automation.template_name, language: automation.template_language, components });
    await logMessageAttempt({
      eventId, phone: result.phone, templateName: automation.template_name, templateLanguage: automation.template_language,
      status: "accepted", metaMessageId: result.messageId || null, requestPayload: result.requestPayload, responsePayload: result.response
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
