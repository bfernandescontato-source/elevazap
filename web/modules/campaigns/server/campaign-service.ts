import type { SupabaseClient } from "@supabase/supabase-js";

type Database = SupabaseClient;

function isMissingColumn(error: unknown, column: string) {
  if (!error || typeof error !== "object") return false;
  const current = error as { code?: string; message?: string };
  return ["PGRST204", "42703"].includes(current.code || "") && new RegExp(column, "i").test(current.message || "");
}

async function assertGroups(database: Database, accountId: string, groupJids: string[]) {
  const { data, error } = await database.from("grupos").select("group_jid").eq("account_id", accountId).in("group_jid", groupJids);
  if (error) throw error;
  if ((data || []).length !== groupJids.length) throw new Error("Um ou mais grupos não foram encontrados.");
}

async function resolveSenderId(database: Database, accountId: string, senderId: string | null): Promise<string | null> {
  if (!senderId) return null;
  const { data, error } = await database.from("whatsapp_senders").select("id").eq("id", senderId).eq("account_id", accountId).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Número responsável não encontrado.");
  return data.id as string;
}

async function insertGroups(database: Database, accountId: string, campaignId: string, groupJids: string[]) {
  const rows = groupJids.map((group_jid, index) => ({ account_id: accountId, campanha_id: campaignId, group_jid, position: index + 1 }));
  let result = await database.from("campanha_grupos").insert(rows);
  if (isMissingColumn(result.error, "position")) {
    result = await database.from("campanha_grupos").insert(rows.map(({ position: _position, ...row }) => row));
  }
  if (result.error) throw result.error;
}

export async function listCampaigns(database: Database, accountId: string) {
  const { data, error } = await database.from("campanhas")
    .select("id,nome,whatsapp_sender_id,created_at,whatsapp_senders(id,label,session_name),campanha_grupos(group_jid,grupos(group_jid,nome,qtd_membros,sou_admin,foto_url))")
    .eq("account_id", accountId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data || []).map((campaign: any) => ({
    id: campaign.id,
    nome: campaign.nome,
    whatsapp_sender_id: campaign.whatsapp_sender_id,
    numero: campaign.whatsapp_senders,
    created_at: campaign.created_at,
    grupos: (campaign.campanha_grupos || []).map((item: any) => item.grupos || { group_jid: item.group_jid })
  }));
}

export async function createCampaign(database: Database, accountId: string, input: { nome: string; groupJids: string[]; senderId: string | null }) {
  const [, senderId] = await Promise.all([assertGroups(database, accountId, input.groupJids), resolveSenderId(database, accountId, input.senderId)]);
  const { data: campaign, error } = await database.from("campanhas")
    .insert({ account_id: accountId, nome: input.nome.trim(), whatsapp_sender_id: senderId })
    .select("*").single();
  if (error) throw error;
  try {
    await insertGroups(database, accountId, campaign.id, input.groupJids);
  } catch (groupError) {
    await database.from("campanhas").delete().eq("id", campaign.id).eq("account_id", accountId);
    throw groupError;
  }
  return { ok: true, campanha: campaign };
}

async function replaceGroups(database: Database, accountId: string, campaignId: string, groupJids: string[]) {
  const [{ data: campaign, error: campaignError }] = await Promise.all([
    database.from("campanhas").select("id").eq("id", campaignId).eq("account_id", accountId).maybeSingle(),
    assertGroups(database, accountId, groupJids)
  ]);
  if (campaignError) throw campaignError;
  if (!campaign) throw new Error("Campanha não encontrada.");
  const { data: current, error } = await database.from("campanha_grupos").select("group_jid").eq("campanha_id", campaignId).eq("account_id", accountId);
  if (error) throw error;
  const currentJids = new Set((current || []).map((row: any) => row.group_jid));
  const wanted = new Set(groupJids);
  const removed = [...currentJids].filter((jid) => !wanted.has(jid));
  if (removed.length) {
    const result = await database.from("campanha_grupos").delete().eq("campanha_id", campaignId).eq("account_id", accountId).in("group_jid", removed);
    if (result.error) throw result.error;
  }
  for (const [index, groupJid] of groupJids.entries()) {
    if (!currentJids.has(groupJid)) await insertGroups(database, accountId, campaignId, [groupJid]);
    else {
      const result = await database.from("campanha_grupos").update({ position: index + 1 }).eq("campanha_id", campaignId).eq("account_id", accountId).eq("group_jid", groupJid);
      if (result.error && !isMissingColumn(result.error, "position")) throw result.error;
    }
  }
  return { ok: true, group_count: groupJids.length };
}

export async function updateCampaign(database: Database, accountId: string, input: { id: string; nome?: string; whatsapp_sender_id?: string | null; group_jids?: string[] }) {
  if (input.nome) {
    const result = await database.from("campanhas").update({ nome: input.nome, updated_at: new Date().toISOString() }).eq("id", input.id).eq("account_id", accountId);
    if (result.error) throw result.error;
  }
  if (input.whatsapp_sender_id !== undefined) {
    const senderId = await resolveSenderId(database, accountId, input.whatsapp_sender_id);
    const result = await database.from("campanhas").update({ whatsapp_sender_id: senderId, updated_at: new Date().toISOString() }).eq("id", input.id).eq("account_id", accountId);
    if (result.error) throw result.error;
  }
  return input.group_jids ? replaceGroups(database, accountId, input.id, input.group_jids) : { ok: true };
}

export async function deleteCampaign(database: Database, accountId: string, campaignId: string) {
  const { error } = await database.from("campanhas").delete().eq("id", campaignId).eq("account_id", accountId);
  if (error) throw error;
  return { ok: true };
}
