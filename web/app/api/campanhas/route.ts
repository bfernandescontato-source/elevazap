import { NextRequest, NextResponse } from "next/server";
import { createCampanhaSchema, updateCampanhaSchema } from "@/lib/schemas";
import { validateGroupJid } from "@/lib/phone";
import { guardAdminMutation, requireAccountContext } from "@/lib/security";
import { supabaseAdmin } from "@/lib/supabase";

function isMissingRpc(error: any, functionName: string) {
  return Boolean(error && (
    error.code === "PGRST202" ||
    error.code === "42883" ||
    new RegExp(`could not find the function.*${functionName}|function.*${functionName}.*does not exist`, "i").test(error.message || "")
  ));
}

function isMissingColumn(error: any, column: string) {
  return Boolean(error && (error.code === "PGRST204" || error.code === "42703") && new RegExp(column, "i").test(error.message || ""));
}

async function insertCampaignGroups(sb: any, accountId: string, campaignId: string, groupJids: string[]) {
  const withPosition = groupJids.map((group_jid, index) => ({ account_id: accountId, campanha_id: campaignId, group_jid, position: index + 1 }));
  let result = await sb.from("campanha_grupos").insert(withPosition);
  if (isMissingColumn(result.error, "position")) {
    result = await sb.from("campanha_grupos").insert(withPosition.map(({ account_id, campanha_id, group_jid }) => ({ account_id, campanha_id, group_jid })));
  }
  return result;
}

async function createCampaignFallback(sb: any, accountId: string, nome: string, groupJids: string[], senderId: string | null) {
  const { data: groups, error: groupsError } = await sb.from("grupos").select("group_jid").eq("account_id", accountId).in("group_jid", groupJids);
  if (groupsError) throw groupsError;
  if ((groups || []).length !== groupJids.length) throw new Error("Um ou mais grupos não foram encontrados.");
  if (senderId) {
    const { data: sender, error: senderError } = await sb.from("whatsapp_senders").select("id").eq("id", senderId).eq("account_id", accountId).maybeSingle();
    if (senderError) throw senderError;
    if (!sender) throw new Error("Número responsável não encontrado.");
  }

  const { data: campaign, error: campaignError } = await sb.from("campanhas")
    .insert({ account_id: accountId, nome: nome.trim(), whatsapp_sender_id: senderId })
    .select("*")
    .single();
  if (campaignError) throw campaignError;

  const groupsResult = await insertCampaignGroups(sb, accountId, campaign.id, groupJids);
  if (groupsResult.error) {
    await sb.from("campanhas").delete().eq("id", campaign.id).eq("account_id", accountId);
    throw groupsResult.error;
  }
  return { ok: true, campanha: campaign };
}

async function replaceCampaignGroupsFallback(sb: any, accountId: string, campaignId: string, groupJids: string[]) {
  const { data: campaign, error: campaignError } = await sb.from("campanhas").select("id").eq("id", campaignId).eq("account_id", accountId).maybeSingle();
  if (campaignError) throw campaignError;
  if (!campaign) throw new Error("Campanha não encontrada.");
  const { data: groups, error: groupsError } = await sb.from("grupos").select("group_jid").eq("account_id", accountId).in("group_jid", groupJids);
  if (groupsError) throw groupsError;
  if ((groups || []).length !== groupJids.length) throw new Error("Um ou mais grupos não foram encontrados.");

  const { data: current, error: currentError } = await sb.from("campanha_grupos").select("group_jid").eq("campanha_id", campaignId).eq("account_id", accountId);
  if (currentError) throw currentError;
  const wanted = new Set(groupJids);
  const remove = (current || []).map((row: any) => row.group_jid).filter((jid: string) => !wanted.has(jid));
  if (remove.length) {
    const { error } = await sb.from("campanha_grupos").delete().eq("campanha_id", campaignId).eq("account_id", accountId).in("group_jid", remove);
    if (error) throw error;
  }
  for (const [index, groupJid] of groupJids.entries()) {
    const existing = (current || []).some((row: any) => row.group_jid === groupJid);
    if (existing) {
      const { error } = await sb.from("campanha_grupos").update({ position: index + 1 }).eq("campanha_id", campaignId).eq("account_id", accountId).eq("group_jid", groupJid);
      if (error && !isMissingColumn(error, "position")) throw error;
    } else {
      const result = await insertCampaignGroups(sb, accountId, campaignId, [groupJid]);
      if (result.error) throw result.error;
    }
  }
  return { ok: true, group_count: groupJids.length };
}

export async function GET() {
  const context = await requireAccountContext();
  if (context.error) return context.error;
  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("campanhas")
    .select("id,nome,whatsapp_sender_id,created_at,whatsapp_senders(id,label,session_name),campanha_grupos(group_jid,grupos(group_jid,nome,qtd_membros,sou_admin,foto_url))")
    .eq("account_id", context.accountId)
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const campanhas = (data || []).map((campanha: any) => ({
    id: campanha.id,
    nome: campanha.nome,
    whatsapp_sender_id: campanha.whatsapp_sender_id,
    numero: campanha.whatsapp_senders,
    created_at: campanha.created_at,
    grupos: (campanha.campanha_grupos || []).map((item: any) => item.grupos || { group_jid: item.group_jid })
  }));
  return NextResponse.json(campanhas);
}

export async function POST(request: NextRequest) {
  const guard = await guardAdminMutation(request, "campanhas_ip");
  if (guard) return guard;
  const context = await requireAccountContext();
  if (context.error) return context.error;
  const parsed = createCampanhaSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Campanha inválida." }, { status: 400 });
  const body = parsed.data;
  const groupJids = Array.from(new Set(body.group_jids));
  if (groupJids.some((jid) => !validateGroupJid(jid))) return NextResponse.json({ error: "Grupo inválido." }, { status: 400 });

  const sb = supabaseAdmin();
  try { return NextResponse.json(await createCampaignFallback(sb, context.accountId, body.nome, groupJids, body.whatsapp_sender_id || null)); }
  catch (fallbackError: any) { return NextResponse.json({ error: fallbackError?.message || "Não foi possível criar a campanha." }, { status: 500 }); }
}

export async function PATCH(request: NextRequest) {
  const guard = await guardAdminMutation(request, "campanhas_ip");
  if (guard) return guard;
  const context = await requireAccountContext();
  if (context.error) return context.error;
  const parsed = updateCampanhaSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Campanha inválida." }, { status: 400 });
  const body = parsed.data;
  const sb = supabaseAdmin();

  if (body.nome) {
    const { error } = await sb.from("campanhas").update({ nome: body.nome, updated_at: new Date().toISOString() }).eq("id", body.id).eq("account_id", context.accountId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (body.whatsapp_sender_id !== undefined) {
    if (body.whatsapp_sender_id) {
      const { data: sender } = await sb.from("whatsapp_senders").select("id").eq("id", body.whatsapp_sender_id).eq("account_id", context.accountId).maybeSingle();
      if (!sender) return NextResponse.json({ error: "Número responsável não encontrado." }, { status: 400 });
    }
    const { error } = await sb.from("campanhas").update({ whatsapp_sender_id: body.whatsapp_sender_id, updated_at: new Date().toISOString() }).eq("id", body.id).eq("account_id", context.accountId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (body.group_jids) {
    const groupJids = Array.from(new Set(body.group_jids));
    if (groupJids.some((jid) => !validateGroupJid(jid))) return NextResponse.json({ error: "Grupo inválido." }, { status: 400 });
    try { return NextResponse.json(await replaceCampaignGroupsFallback(sb, context.accountId, body.id, groupJids)); }
    catch (fallbackError: any) { return NextResponse.json({ error: fallbackError?.message || "Não foi possível atualizar os grupos da campanha." }, { status: 500 }); }
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(request: NextRequest) {
  const guard = await guardAdminMutation(request, "campanhas_ip");
  if (guard) return guard;
  const context = await requireAccountContext();
  if (context.error) return context.error;
  const { id } = await request.json();
  if (!id) return NextResponse.json({ error: "Campanha inválida." }, { status: 400 });
  const { error } = await supabaseAdmin().from("campanhas").delete().eq("id", id).eq("account_id", context.accountId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
