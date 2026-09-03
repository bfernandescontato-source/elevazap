import { supabase } from "../supabase.js";
import { OfferProcessor } from "./offer-processor.js";
import { sharedMediaCache } from "../utils/media.js";

export async function retryCapturedOffer(accountId: string, offerId: string) {
  const { data: offer, error } = await supabase.from("captured_offers").select("*")
    .eq("id", offerId).eq("account_id", accountId).eq("status", "processing_failed").maybeSingle();
  if (error) throw error;
  if (!offer || offer.affiliate_conversion_status !== "failed") throw new Error("Esta oferta não possui uma conversão pendente de nova tentativa.");
  const { data: automation, error: automationError } = await supabase.from("offer_automations").select("*,whatsapp_senders(session_name)")
    .eq("id", offer.automation_id).eq("account_id", accountId).maybeSingle();
  if (automationError) throw automationError;
  if (!automation) throw new Error("Automação não encontrada.");
  let media: { buffer: Buffer; mimeType: string; extension: string } | undefined;
  if (offer.media_bucket && offer.media_path) {
    const key = `${offer.media_bucket}:${offer.media_path}`;
    const buffer = await sharedMediaCache.getOrLoad(key, async () => {
      const { data, error: mediaError } = await supabase.storage.from(offer.media_bucket).download(offer.media_path);
      if (mediaError) throw mediaError;
      return Buffer.from(await data.arrayBuffer());
    });
    const mimeType = offer.media_mime_type || "image/jpeg";
    media = { buffer, mimeType, extension: mimeType === "image/png" ? "png" : mimeType === "image/webp" ? "webp" : "jpg" };
  }
  const result = await new OfferProcessor(supabase).process(automation as never, {
    sourceType: offer.source_type,
    sourceMessageId: `${offer.source_message_id}:retry:${Number(offer.affiliate_conversion_attempts || 0) + 1}`,
    sourceGroupId: offer.source_group_id,
    senderId: offer.sender_id || undefined,
    text: offer.original_text || "",
    media,
    timestamp: new Date()
  });
  if (!result) throw new Error("A nova tentativa não criou uma oferta.");
  await supabase.from("captured_offers").update({ status: "ignored", error_message: `Nova tentativa criada: ${result.id}`, updated_at: new Date().toISOString() })
    .eq("id", offerId).eq("account_id", accountId);
  return result;
}
