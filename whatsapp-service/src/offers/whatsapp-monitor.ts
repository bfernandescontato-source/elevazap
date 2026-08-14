import { downloadContentFromMessage } from "@whiskeysockets/baileys";
import type { SupabaseClient } from "@supabase/supabase-js";
import { OfferProcessor, offerMessageIdFallback } from "./offer-processor.js";
import { offerFeatureFlags } from "./feature-flags.js";
import type { RawOfferMessage } from "./types.js";

function unwrapMessage(message: any): any {
  return message?.ephemeralMessage?.message || message?.viewOnceMessage?.message ||
    message?.viewOnceMessageV2?.message || message;
}

async function mediaFrom(message: any): Promise<RawOfferMessage["media"]> {
  const image = message?.imageMessage;
  if (!image) return undefined;
  const stream = await downloadContentFromMessage(image, "image");
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  const mimeType = image.mimetype || "image/jpeg";
  const extension = mimeType === "image/png" ? "png" : mimeType === "image/webp" ? "webp" : "jpg";
  return { buffer: Buffer.concat(chunks), mimeType, extension };
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
