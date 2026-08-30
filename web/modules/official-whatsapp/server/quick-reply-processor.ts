import { normalizeBrazilianPhone } from "@/lib/phone";
import { findActiveQuickReplyAction } from "./quick-reply-actions";
import { findRecentHublaContextByPhone, markEventStatus } from "./hubla-events";
import { uploadMediaFromStorage } from "./meta-media";
import { sendQuickReplyMessage } from "./send-interactive";
import { logMessageAttempt } from "./messages-store";
import { renderTemplateText, type EventContext } from "./variable-resolver";
import { officialErrorCode, officialErrorMessage } from "./errors";

// Chamado via after() pelo webhook da Meta — resposta HTTP já foi enviada. Uma única resposta
// por payload de botão, sem fila/steps. Contexto (nome/produto) é melhor-esforço: procura o
// evento de compra mais recente com esse telefone, não cria/mantém contato nenhum.
export async function processQuickReplyClick(eventId: string, payload: string, fromPhone: string, connectionId: string | null = null) {
  const action = await findActiveQuickReplyAction(payload);
  if (!action) {
    await markEventStatus(eventId, "ignored", null, { quickReplyActionId: null });
    return;
  }

  let phone: string;
  try {
    phone = normalizeBrazilianPhone(fromPhone);
  } catch {
    await markEventStatus(eventId, "failed", "INVALID_PHONE: telefone do clique inválido.", { quickReplyActionId: action.id });
    return;
  }

  const recent = await findRecentHublaContextByPhone(phone);
  const context: EventContext = {
    customerName: recent?.customer_name ?? null,
    productName: recent?.product_name ?? null,
    customerEmail: null,
    customerPhone: phone,
    amountCents: null,
    paymentUrl: null,
    accessUrl: null
  };

  const textResult = action.response_text ? renderTemplateText(action.response_text, context) : null;
  const captionResult = action.caption ? renderTemplateText(action.caption, context) : null;
  const missing = [...(textResult?.missing || []), ...(captionResult?.missing || [])];
  if (missing.length) {
    await markEventStatus(eventId, "failed", `MISSING_TEMPLATE_VARIABLE: ${missing.join(", ")}`, { quickReplyActionId: action.id });
    return;
  }

  let mediaId: string | null = null;
  try {
    if (action.response_type !== "text" && action.media_bucket && action.media_path) {
      mediaId = await uploadMediaFromStorage(action.media_bucket, action.media_path, action.mime_type || "application/octet-stream", action.file_name || "arquivo", connectionId);
    }
  } catch (error) {
    const summary = `${officialErrorCode(error)}: ${officialErrorMessage(error)}`.slice(0, 500);
    await logMessageAttempt({ eventId, phone, status: "failed", error: summary }).catch(() => {});
    await markEventStatus(eventId, "failed", summary, { quickReplyActionId: action.id });
    return;
  }

  try {
    const result = await sendQuickReplyMessage(action, phone, { text: textResult?.text ?? null, caption: captionResult?.text ?? null, mediaId }, undefined, connectionId);
    await logMessageAttempt({
      eventId, phone: result.phone, status: "accepted", metaMessageId: result.messageId || null,
      requestPayload: result.requestPayload, responsePayload: result.response, connectionId
    });
    await markEventStatus(eventId, "processed", null, { quickReplyActionId: action.id });
  } catch (error) {
    const summary = `${officialErrorCode(error)}: ${officialErrorMessage(error)}`.slice(0, 500);
    await logMessageAttempt({ eventId, phone, status: "failed", error: summary }).catch(() => {});
    await markEventStatus(eventId, "failed", summary, { quickReplyActionId: action.id });
  }
}
