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
  let sender = Array.isArray(campaign.whatsapp_senders) ? campaign.whatsapp_senders[0] : campaign.whatsapp_senders;
  let senderId = campaign.whatsapp_sender_id as string | null;
  if (!sender?.session_name) {
    const { data: firstSender, error: senderError } = await sb.from("whatsapp_senders")
      .select("id,session_name")
      .eq("account_id", accountId)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (senderError) throw senderError;
    if (!firstSender) throw new Error("A campanha não possui um número WhatsApp conectado.");
    sender = firstSender;
    senderId = firstSender.id;
    const { error: linkError } = await sb.from("campanhas").update({ whatsapp_sender_id: senderId, updated_at: new Date().toISOString() }).eq("id", campaignId).eq("account_id", accountId);
    if (linkError) throw linkError;
  }
  const endpoint = `/senders/${sender.session_name}/groups/sync`;

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
      await sb.from("group_participant_syncs").insert({ account_id: accountId, group_jid: groupJid, whatsapp_sender_id: senderId, status: "erro", error: message });
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
      whatsapp_sender_id: senderId,
      participant_count: row.qtd_membros,
      status: row.participant_error ? "erro" : "sucesso",
      error: row.participant_error || row.invite_error || null,
      created_at: row.synced_at
    });
  }));
  return rows;
}

/** Atualiza apenas os links de convite, sem alterar métricas de participantes. */
export async function syncCampaignGroupInviteLinks(accountId: string, campaignId: string) {
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
  if (!groupJids.length) return { total: 0, updated: 0 };

  let sender = Array.isArray(campaign.whatsapp_senders) ? campaign.whatsapp_senders[0] : campaign.whatsapp_senders;
  if (!sender?.session_name) {
    const { data: firstSender, error: senderError } = await sb.from("whatsapp_senders")
      .select("id,session_name")
      .eq("account_id", accountId)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (senderError) throw senderError;
    if (!firstSender) throw new Error("A campanha não possui um número WhatsApp conectado.");
    sender = firstSender;
  }

  const result = await callWhatsappService(`/senders/${sender.session_name}/groups/sync`, {
    method: "POST",
    body: JSON.stringify({ groupJids })
  });
  const rows: SyncedGroup[] = Array.isArray(result.groups) ? result.groups : [];
  const links = rows.filter((row) => row.invite_url && /^https:\/\/chat\.whatsapp\.com\//.test(row.invite_url));
  const now = new Date().toISOString();
  await Promise.all(links.map((row) => sb.from("campanha_grupos")
    .update({ invite_url: row.invite_url, updated_at: now })
    .eq("campanha_id", campaignId)
    .eq("account_id", accountId)
    .eq("group_jid", row.group_jid)));

  return { total: groupJids.length, updated: links.length };
}
