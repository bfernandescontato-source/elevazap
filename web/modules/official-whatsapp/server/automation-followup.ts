import { supabaseAdmin } from "@/lib/supabase";
import { normalizeBrazilianPhone } from "@/lib/phone";
import { followupConfigSchema, type FollowupConfig } from "../automation-config";
import { markEventStatus } from "./hubla-events";
import { logMessageAttempt } from "./messages-store";
import type { QuickReplyAction } from "./quick-reply-actions";
import { sendQuickReplyMessage } from "./send-interactive";
import { uploadMediaFromStorage } from "./meta-media";
import { renderTemplateText, type EventContext } from "./variable-resolver";
import { officialErrorMessage } from "./errors";

export type AutomationSnapshot = { version: 1; mode: "none" | "button"; context: EventContext; triggerPayload: string | null; config: FollowupConfig | null };

export function isAutomationReplyMatch(snapshot: AutomationSnapshot, phone: string, connectionId: string | null, original: { phone: string; connection_id: string | null }, payload: string) {
  return snapshot.mode === "button" && snapshot.triggerPayload === payload && original.phone === phone && (original.connection_id || null) === connectionId;
}

// Snapshot belongs to the original send, not the current editor or a shared button label.
export async function processAutomationButtonClick(eventId: string, click: { from: string; button: { payload: string }; context?: { id?: string } }, connectionId: string | null): Promise<boolean> {
  const admin = supabaseAdmin();
  const replyId = click.context?.id;
  if (!replyId) {
    if (!click.button.payload.startsWith("automation:")) return false;
    await markEventStatus(eventId, "ignored", "Clique sem mensagem original.");
    return true;
  }
  const { data: original, error } = await admin.from("official_messages").select("id,phone,connection_id,automation_id,automation_snapshot,automation_reply_state").eq("meta_message_id", replyId).maybeSingle();
  if (error) throw error;
  if (!original?.automation_snapshot) {
    if (!click.button.payload.startsWith("automation:")) return false;
    await markEventStatus(eventId, "ignored", "Mensagem original da automação não encontrada.");
    return true;
  }
  const snapshot = original.automation_snapshot as AutomationSnapshot;
  let phone: string;
  try { phone = normalizeBrazilianPhone(click.from); }
  catch { await markEventStatus(eventId, "ignored", "Remetente inválido."); return true; }
  if (!isAutomationReplyMatch(snapshot, phone, connectionId, original, click.button.payload)) {
    await markEventStatus(eventId, "ignored", "Este clique não corresponde à segunda mensagem configurada.");
    return true;
  }
  // Compare-and-set: two clicks/deliveries cannot send the same follow-up twice.
  const { data: claimed, error: claimError } = await admin.from("official_messages").update({ automation_reply_state: "sending" }).eq("id", original.id).eq("automation_reply_state", "waiting").select("id").maybeSingle();
  if (claimError) throw claimError;
  if (!claimed) { await markEventStatus(eventId, "ignored", "Segunda mensagem já processada ou em processamento."); return true; }
  let accepted = false;
  try {
    const config = followupConfigSchema.parse(snapshot.config);
    const text = renderTemplateText(config.responseText || "", snapshot.context);
    const caption = renderTemplateText(config.caption || "", snapshot.context);
    if (text.missing.length || caption.missing.length) throw new Error("Faltam dados para personalizar a segunda mensagem.");
    const mediaId = config.responseType !== "text" ? await uploadMediaFromStorage(config.mediaBucket!, config.mediaPath!, config.mimeType!, config.fileName || "arquivo", connectionId) : null;
    const action: QuickReplyAction = { id: original.automation_id, payload: snapshot.triggerPayload!, button_label: null, response_type: config.responseType, response_text: config.responseText, caption: config.caption, media_bucket: config.mediaBucket, media_path: config.mediaPath, mime_type: config.mimeType, file_name: config.fileName, button_config: config.buttonConfig, active: true, created_at: "", updated_at: "" };
    const result = await sendQuickReplyMessage(action, phone, { text: text.text, caption: caption.text, mediaId }, undefined, connectionId);
    accepted = true;
    await admin.from("official_messages").update({ automation_reply_state: "sent" }).eq("id", original.id);
    await logMessageAttempt({ eventId, phone, connectionId, automationId: original.automation_id, status: "accepted", metaMessageId: result.messageId, requestPayload: result.requestPayload, responsePayload: result.response, attribution: { sourceType: "automation", sourceId: original.automation_id, messageKey: "follow_up", phoneNumberId: result.phoneNumberId } });
    await markEventStatus(eventId, "processed", null, { automationId: original.automation_id });
  } catch (failure) {
    // Do not automatically retry an ambiguous delivery or a post-send logging error.
    await admin.from("official_messages").update({ automation_reply_state: accepted ? "sent" : "failed" }).eq("id", original.id);
    await markEventStatus(eventId, "failed", officialErrorMessage(failure).slice(0, 500), { automationId: original.automation_id });
  }
  return true;
}
