import { normalizeBrazilianPhone } from "@/lib/phone";
import { graphRequest, metaIdentifiers } from "./meta-client";
import { OfficialWhatsAppError } from "./errors";
import type { QuickReplyAction } from "./quick-reply-actions";

export type ResolvedContent = { text: string | null; caption: string | null; mediaId: string | null };

// Monta o payload exato da Cloud API. Função pura — sem rede, sem resolver variável, sem subir
// mídia. Áudio nunca pode ter botão: a Meta não aceita áudio como header de mensagem interactive,
// só image/video/document (ou nenhum header, para resposta_type=text).
export function buildQuickReplyMessage(action: QuickReplyAction, phone: string, resolved: ResolvedContent): Record<string, unknown> {
  const base = { messaging_product: "whatsapp", to: phone };
  const buttonConfig = action.response_type === "audio" ? null : action.button_config;

  if (!buttonConfig) {
    if (action.response_type === "text") return { ...base, type: "text", text: { body: resolved.text || "", preview_url: false } };
    if (action.response_type === "audio") return { ...base, type: "audio", audio: { id: resolved.mediaId } };
    const mediaObject = { id: resolved.mediaId, ...(resolved.caption ? { caption: resolved.caption } : {}), ...(action.response_type === "document" && action.file_name ? { filename: action.file_name } : {}) };
    return { ...base, type: action.response_type, [action.response_type]: mediaObject };
  }

  const bodyText = (action.response_type === "text" ? resolved.text : resolved.caption) || "";
  const header = action.response_type === "image" ? { type: "image", image: { id: resolved.mediaId } }
    : action.response_type === "video" ? { type: "video", video: { id: resolved.mediaId } }
    : action.response_type === "document" ? { type: "document", document: { id: resolved.mediaId, ...(action.file_name ? { filename: action.file_name } : {}) } }
    : null;

  const action_ = buttonConfig.type === "url"
    ? { name: "cta_url", parameters: { display_text: buttonConfig.text, url: buttonConfig.url } }
    : { buttons: [{ type: "reply", reply: { id: buttonConfig.payload, title: buttonConfig.text } }] };

  return {
    ...base,
    type: "interactive",
    interactive: {
      type: buttonConfig.type === "url" ? "cta_url" : "button",
      ...(header ? { header } : {}),
      body: { text: bodyText },
      action: action_
    }
  };
}

export async function sendQuickReplyMessage(action: QuickReplyAction, rawPhone: string, resolved: ResolvedContent) {
  let phone: string;
  try {
    phone = normalizeBrazilianPhone(rawPhone);
  } catch {
    throw new OfficialWhatsAppError("INVALID_PHONE", "Telefone do clique inválido.");
  }
  const { phoneNumberId } = metaIdentifiers();
  const requestPayload = buildQuickReplyMessage(action, phone, resolved);
  const response = await graphRequest(`/${phoneNumberId}/messages`, { method: "POST", body: JSON.stringify(requestPayload) });
  return { phone, requestPayload, response, messageId: response?.messages?.[0]?.id as string | undefined };
}
