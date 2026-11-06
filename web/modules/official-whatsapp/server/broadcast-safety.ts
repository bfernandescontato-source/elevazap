import { supabaseAdmin } from "@/lib/supabase";

export async function pauseBroadcastsOnProcessingFailure(connectionId: string | null) {
  let query = supabaseAdmin().from("official_broadcasts").update({ status: "paused" }).eq("status", "processing");
  query = connectionId ? query.eq("connection_id", connectionId) : query.is("connection_id", null);
  const { error } = await query;
  if (error) throw error;
}
