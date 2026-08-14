import { downloadContentFromMessage } from "@whiskeysockets/baileys";
import type { SupabaseClient } from "@supabase/supabase-js";
import { OfferProcessor, offerMessageIdFallback } from "./offer-processor.js";
import { offerFeatureFlags } from "./feature-flags.js";
import type { RawOfferMessage } from "./types.js";

export function unwrapMessage(message: any): any {
  let current = message;
  for (let depth = 0; depth < 8; depth += 1) {
    const nested = current?.ephemeralMessage?.message ||
      current?.viewOnceMessage?.message ||
      current?.viewOnceMessageV2?.message ||
      current?.viewOnceMessageV2Extension?.message ||
      current?.documentWithCaptionMessage?.message ||
      current?.editedMessage?.message;
    if (!nested || nested === current) return current;
    current = nested;
  }
  return current;
}

export async function mediaFrom(message: any): Promise<RawOfferMessage["media"]> {
  const image = message?.imageMessage;
  if (image) {
    const stream = await downloadContentFromMessage(image, "image");
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    const mimeType = image.mimetype || "image/jpeg";
    const extension = mimeType === "image/png" ? "png" : mimeType === "image/webp" ? "webp" : "jpg";
    return { buffer: Buffer.concat(chunks), mimeType, extension };
  }

  const preview = message?.extendedTextMessage;
  if (!preview) return undefined;
  if (preview.thumbnailDirectPath && preview.mediaKey) {
    try {
      const stream = await downloadContentFromMessage({
        directPath: preview.thumbnailDirectPath,
        mediaKey: preview.mediaKey
      }, "thumbnail-link");
      const chunks: Buffer[] = [];
      for await (const chunk of stream) chunks.push(Buffer.from(chunk));
      const buffer = Buffer.concat(chunks);
      if (buffer.length) return { buffer, mimeType: "image/jpeg", extension: "jpg" };
    } catch {
      // Some link previews only keep the embedded JPEG fallback.
    }
  }
  const thumbnail = preview.jpegThumbnail ? Buffer.from(preview.jpegThumbnail) : null;
  return thumbnail?.length ? { buffer: thumbnail, mimeType: "image/jpeg", extension: "jpg" } : undefined;
}

export async function monitorOfferMessages(
  database: SupabaseClient,
  sender: { id: string; accountId: string },
  messages: any[]
) {
  if (!offerFeatureFlags.pilotAutomation) return;
  const processor = new OfferProcessor(database);
  for (const incoming of messages) {
    const groupId = String(incoming?.key?.remoteJid || "");
    if (!groupId.endsWith("@g.us") || incoming?.key?.fromMe) continue;
    const { data: sources, error: sourceError } = await database.from("automation_source_groups")
      .select("automation_id").eq("account_id", sender.accountId).eq("whatsapp_group_id", groupId).eq("enabled", true);
    if (sourceError) {
      if (["42P01", "PGRST205"].includes(sourceError.code || "")) return;
      throw sourceError;
    }
    if (!sources?.length) continue;
    const automationIds = sources.map((source) => source.automation_id);
    const { data: automations, error } = await database.from("offer_automations")
      .select("*,whatsapp_senders(session_name)").eq("account_id", sender.accountId)
      .eq("whatsapp_sender_id", sender.id).eq("enabled", true).in("id", automationIds);
    if (error) throw error;
    if (!automations?.length) continue;
    const content = unwrapMessage(incoming.message);
    const raw: RawOfferMessage = {
      sourceType: "whatsapp",
      sourceMessageId: incoming.key.id || offerMessageIdFallback(),
      sourceGroupId: groupId,
      senderId: incoming.key.participant || incoming.participant,
      text: content?.conversation || content?.extendedTextMessage?.text || "",
      caption: content?.imageMessage?.caption || content?.videoMessage?.caption || "",
      media: await mediaFrom(content),
      timestamp: new Date(Number(incoming.messageTimestamp || Date.now() / 1000) * 1000)
    };
    for (const automation of automations) await processor.process(automation as never, raw);
  }
}
