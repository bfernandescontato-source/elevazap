import type { WhatsAppRuntime } from "../whatsapp.js";
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

export async function syncAllCampaignGroups(runtime: WhatsAppRuntime) {
  const { data: campaigns, error } = await supabase
    .from("campanhas")
    .select("id,account_id,whatsapp_sender_id,whatsapp_senders(session_name),campanha_grupos(group_jid)")
    .eq("status", "ativa");
  if (error) throw error;

  const batches = new Map<string, { accountId: string; senderId: string | null; sessionName: string | null; campaignIds: string[]; groupJids: Set<string> }>();
  for (const campaign of campaigns || []) {
    const sender = Array.isArray(campaign.whatsapp_senders) ? campaign.whatsapp_senders[0] : campaign.whatsapp_senders;
    const key = `${campaign.account_id}:${sender?.session_name || "principal"}`;
    const batch = batches.get(key) || { accountId: campaign.account_id, senderId: campaign.whatsapp_sender_id, sessionName: sender?.session_name || null, campaignIds: [] as string[], groupJids: new Set<string>() };
    batch.campaignIds.push(campaign.id);
    for (const item of campaign.campanha_grupos || []) batch.groupJids.add((item as any).group_jid);
    batches.set(key, batch);
  }

  for (const batch of batches.values()) {
    const groupJids = Array.from(batch.groupJids);
    if (!groupJids.length) continue;
    try {
      const rows = batch.sessionName
        ? await syncSenderGroups(batch.sessionName, groupJids)
        : await runtime.syncGroups(groupJids);
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
