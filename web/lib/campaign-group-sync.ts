import { supabaseAdmin } from "@/lib/supabase";
import { callWhatsappService } from "@/lib/whatsapp-service";

type SyncedGroup = {
  group_jid: string;
  qtd_membros?: number;
  invite_url?: string | null;
  synced_at: string;
  participant_error?: string | null;
  invite_error?: string | null;
};

export async function syncCampaignGroups(accountId: string, campaignId: string) {
  const sb = supabaseAdmin();
  const { data: campaign, error } = await sb
    .from("campanhas")
    .select("id,whatsapp_sender_id,whatsapp_senders(session_name),campanha_grupos(group_jid)")
    .eq("id", campaignId)
    .eq("account_id", accountId)
    .maybeSingle();
  if (error) throw error;
  if (!campaign) throw new Error("Campanha não encontrada.");

  const groupJids = (campaign.campanha_grupos || []).map((item: any) => item.group_jid);
  if (!groupJids.length) return [];
  const sender = Array.isArray(campaign.whatsapp_senders) ? campaign.whatsapp_senders[0] : campaign.whatsapp_senders;
  const endpoint = sender?.session_name
    ? `/senders/${sender.session_name}/groups/sync`
    : "/groups/sync";

  let rows: SyncedGroup[] = [];
  try {
    const result = await callWhatsappService(endpoint, {
      method: "POST",
      body: JSON.stringify({ groupJids })
    });
    rows = Array.isArray(result.groups) ? result.groups : [];
  } catch (currentError: any) {
    const message = currentError?.message || "Falha ao consultar o WhatsApp.";
    await Promise.all(groupJids.map(async (groupJid: string) => {
      await sb.from("campanha_grupos").update({ participants_sync_error: message, updated_at: new Date().toISOString() }).eq("campanha_id", campaignId).eq("account_id", accountId).eq("group_jid", groupJid);
      await sb.from("group_participant_syncs").insert({ account_id: accountId, group_jid: groupJid, whatsapp_sender_id: campaign.whatsapp_sender_id, status: "erro", error: message });
    }));
    throw currentError;
  }

  await Promise.all(rows.map(async (row) => {
    const update: Record<string, unknown> = {
      participants_sync_error: row.participant_error || null,
      updated_at: new Date().toISOString()
    };
    if (row.qtd_membros !== undefined) {
      update.participant_count = row.qtd_membros;
      update.participants_synced_at = row.synced_at;
    }
    if (row.invite_url) update.invite_url = row.invite_url;
    await sb.from("campanha_grupos").update(update).eq("campanha_id", campaignId).eq("account_id", accountId).eq("group_jid", row.group_jid);
    await sb.from("group_participant_syncs").insert({
      account_id: accountId,
      group_jid: row.group_jid,
      whatsapp_sender_id: campaign.whatsapp_sender_id,
      participant_count: row.qtd_membros,
      status: row.participant_error ? "erro" : "sucesso",
      error: row.participant_error || row.invite_error || null,
      created_at: row.synced_at
    });
  }));
  return rows;
}
