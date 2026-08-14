import type { SupabaseClient } from "@supabase/supabase-js";
import type { ParsedOffer } from "./types.js";

export type DeduplicationCandidate = { id: string; original_link?: string | null; content_hash: string; item_id?: string | null };

export function classifyDuplicate(history: DeduplicationCandidate[], offer: Pick<ParsedOffer, "links" | "contentHash"> & { itemId?: string }) {
  return history.find((item) => item.content_hash === offer.contentHash || Boolean(item.original_link && offer.links.includes(item.original_link)) || Boolean(item.item_id && offer.itemId && item.item_id === offer.itemId))?.id || null;
}

export async function findDuplicate(
  database: SupabaseClient,
  accountId: string,
  automationId: string,
  offer: ParsedOffer,
  windowHours: number
) {
  const since = new Date(offer.capturedAt.getTime() - windowHours * 3_600_000).toISOString();
  const { data, error } = await database.from("captured_offers").select("id,original_link,content_hash,item_id")
    .eq("account_id", accountId).eq("automation_id", automationId)
    .gte("captured_at", since).neq("source_message_id", offer.sourceMessageId)
    .not("status", "in", "(ignored,duplicate,processing_failed)")
    .order("captured_at", { ascending: false }).limit(500);
  if (error) throw error;
  return classifyDuplicate(data || [], offer);
}
