import { supabase } from "../supabase.js";
import { syncSenderGroups } from "../senders/runtime.js";
import type { SyncedGroup } from "./sync.js";
import { dbResult } from "../utils/db.js";

async function persist(accountId: string, campaignIds: string[], senderId: string | null, rows: SyncedGroup[]) {
  for (const row of rows) {
    const update: Record<string, unknown> = {
      participants_sync_error: row.participant_error || null,
      updated_at: new Date().toISOString()
    };
    if (row.qtd_membros !== undefined) {
      update.participant_count = row.qtd_membros;
      update.participants_synced_at = row.synced_at;
    }
    if (row.invite_url) update.invite_url = row.invite_url;
    await dbResult("campaign-groups.persist", supabase.from("campanha_grupos").update(update).eq("account_id", accountId).in("campanha_id", campaignIds).eq("group_jid", row.group_jid));
    await dbResult("campaign-groups.audit", supabase.from("group_participant_syncs").insert({
      account_id: accountId,
      group_jid: row.group_jid,
      whatsapp_sender_id: senderId,
      participant_count: row.qtd_membros,
      status: row.participant_error ? "erro" : "sucesso",
      error: row.participant_error || row.invite_error || null,
      created_at: row.synced_at
    }));
  }
}

export async function syncAllCampaignGroups() {
  const [{ data: campaigns, error }, { data: senderRows, error: sendersError }] = await Promise.all([
    supabase.from("campanhas").select("id,account_id,campanha_grupos(group_jid)").eq("status", "ativa"),
    supabase.from("whatsapp_senders").select("id,account_id,session_name,created_at").order("created_at", { ascending: true })
  ]);
  if (error) throw error;
  if (sendersError) throw sendersError;

  // Group sync uses any available sender for the account — never reads from campaign
  const firstSenderByAccount = new Map<string, { id: string; session_name: string }>();
  for (const sender of senderRows || []) if (!firstSenderByAccount.has(sender.account_id)) firstSenderByAccount.set(sender.account_id, sender);

  const batches = new Map<string, { accountId: string; senderId: string | null; sessionName: string | null; campaignIds: string[]; groupJids: Set<string> }>();
  for (const campaign of campaigns || []) {
    const sender = firstSenderByAccount.get(campaign.account_id);
    const key = `${campaign.account_id}:${sender?.session_name || "sem-sessao"}`;
    const batch = batches.get(key) || { accountId: campaign.account_id, senderId: sender?.id || null, sessionName: sender?.session_name || null, campaignIds: [] as string[], groupJids: new Set<string>() };
    batch.campaignIds.push(campaign.id);
    for (const item of campaign.campanha_grupos || []) batch.groupJids.add((item as any).group_jid);
    batches.set(key, batch);
  }

  for (const batch of batches.values()) {
    const groupJids = Array.from(batch.groupJids);
    if (!groupJids.length) continue;
    try {
      if (!batch.sessionName) throw new Error("Campanha sem número WhatsApp associado.");
      const rows = await syncSenderGroups(batch.sessionName, groupJids);
      await persist(batch.accountId, batch.campaignIds, batch.senderId, rows);
    } catch (currentError: any) {
      const message = currentError?.message || "Falha ao sincronizar participantes.";
      for (const groupJid of groupJids) {
        await dbResult("campaign-groups.persist-error", supabase.from("campanha_grupos").update({ participants_sync_error: message, updated_at: new Date().toISOString() }).eq("account_id", batch.accountId).in("campanha_id", batch.campaignIds).eq("group_jid", groupJid));
        await dbResult("campaign-groups.audit-error", supabase.from("group_participant_syncs").insert({ account_id: batch.accountId, group_jid: groupJid, whatsapp_sender_id: batch.senderId, status: "erro", error: message }));
      }
    }
  }
}
