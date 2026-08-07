import { supabase } from "../supabase.js";

/**
 * Repairs group jobs created before sender assignment became mandatory.
 * Those rows are intentionally ignored by the claim RPC until a tenant-owned
 * WhatsApp session is attached, so resolve the campaign sender (or the first
 * sender for the account) before the queue starts.
 */
export async function repairPendingGroupJobsWithoutSession() {
  const { data: jobs, error } = await supabase.from("envios_grupo")
    .select("id,account_id,lote_id")
    .eq("status", "pendente")
    .is("whatsapp_session_name", null)
    .limit(500);
  if (error) throw error;

  let repaired = 0;
  for (const job of jobs || []) {
    const { data: lote, error: loteError } = await supabase.from("envios_grupo_lotes")
      .select("whatsapp_sender_id,whatsapp_session_name,campanha_id")
      .eq("id", job.lote_id)
      .eq("account_id", job.account_id)
      .maybeSingle();
    if (loteError || !lote) continue;

    let senderId = lote.whatsapp_sender_id;
    let sessionName = lote.whatsapp_session_name;
    if (!sessionName && lote.campanha_id) {
      const { data: campaign } = await supabase.from("campanhas")
        .select("whatsapp_sender_id")
        .eq("id", lote.campanha_id)
        .eq("account_id", job.account_id)
        .maybeSingle();
      senderId = campaign?.whatsapp_sender_id || senderId;
    }

    let sender: { id: string; session_name: string } | null = null;
    if (senderId) {
      const { data } = await supabase.from("whatsapp_senders")
        .select("id,session_name")
        .eq("id", senderId)
        .eq("account_id", job.account_id)
        .maybeSingle();
      sender = data;
    }
    if (!sender) {
      const { data } = await supabase.from("whatsapp_senders")
        .select("id,session_name")
        .eq("account_id", job.account_id)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      sender = data;
    }
    if (!sender?.session_name) continue;

    const values = { whatsapp_sender_id: sender.id, whatsapp_session_name: sender.session_name, updated_at: new Date().toISOString() };
    const { error: jobError } = await supabase.from("envios_grupo").update(values).eq("id", job.id).eq("account_id", job.account_id);
    if (jobError) continue;
    if (!lote.whatsapp_session_name) {
      await supabase.from("envios_grupo_lotes").update(values).eq("id", job.lote_id).eq("account_id", job.account_id);
    }
    repaired += 1;
  }

  if (repaired) console.info({ event: "queue.repaired_missing_group_sessions", repaired });
  return repaired;
}
