import { NextRequest, NextResponse } from "next/server";
import { createLoteSchema } from "@/lib/schemas";
import { validateGroupJid } from "@/lib/phone";
import { guardAdminMutation, requireAccountContext } from "@/lib/security";
import { supabaseAdmin } from "@/lib/supabase";

function isMissingLoteRpc(error: any) {
  return Boolean(error && (
    error.code === "PGRST202" ||
    error.code === "42883" ||
    /could not find the function.*create_group_lote_atomic|function.*create_group_lote_atomic.*does not exist/i.test(error.message || "")
  ));
}

async function createLoteFallback(sb: any, accountId: string, body: any, groupJids: string[]) {
  const scheduledAt = body.scheduled_at || new Date().toISOString();
  const { data: groups, error: groupsError } = await sb.from("grupos").select("group_jid,nome").eq("account_id", accountId).in("group_jid", groupJids);
  if (groupsError) throw groupsError;
  if ((groups || []).length !== groupJids.length) throw new Error("Um ou mais grupos não foram encontrados.");

  let sender: any = null;
  if (body.whatsapp_sender_id) {
    const { data, error } = await sb.from("whatsapp_senders").select("id,session_name").eq("id", body.whatsapp_sender_id).eq("account_id", accountId).maybeSingle();
    if (error) throw error;
    if (!data) throw new Error("Número responsável não encontrado.");
    sender = data;
  }
  if (body.campanha_id) {
    const { data, error } = await sb.from("campanhas").select("id").eq("id", body.campanha_id).eq("account_id", accountId).maybeSingle();
    if (error) throw error;
    if (!data) throw new Error("Campanha não encontrada.");
  }

  const media = body.media || {};
  const { data: lote, error: loteError } = await sb.from("envios_grupo_lotes").insert({
    account_id: accountId,
    titulo: body.titulo.trim(),
    campanha_id: body.campanha_id || null,
    whatsapp_sender_id: sender?.id || null,
    whatsapp_session_name: sender?.session_name || null,
    tipo: body.tipo,
    texto: body.texto || null,
    legenda: body.legenda || null,
    mention_all: Boolean(body.mention_all),
    media_bucket: media.bucket || null,
    media_path: media.storage_path || null,
    file_name: media.file_name || null,
    mime_type: media.mime_type || null,
    file_size_bytes: media.file_size_bytes || null,
    total: groupJids.length,
    pendentes: groupJids.length,
    scheduled_at: scheduledAt
  }).select("*").single();
  if (loteError) throw loteError;

  const groupByJid = new Map<string, any>((groups || []).map((group: any) => [group.group_jid, group] as [string, any]));
  const { error: itemsError } = await sb.from("envios_grupo").insert(groupJids.map((groupJid: string) => ({
    account_id: accountId,
    lote_id: lote.id,
    whatsapp_sender_id: sender?.id || null,
    whatsapp_session_name: sender?.session_name || null,
    group_jid: groupJid,
    nome_grupo: groupByJid.get(groupJid)?.nome || groupJid,
    tipo: body.tipo,
    texto: body.texto || null,
    legenda: body.legenda || null,
    mention_all: Boolean(body.mention_all),
    media_bucket: media.bucket || null,
    media_path: media.storage_path || null,
    file_name: media.file_name || null,
    mime_type: media.mime_type || null,
    file_size_bytes: media.file_size_bytes || null,
    scheduled_at: scheduledAt
  })));
  if (itemsError) {
    await sb.from("envios_grupo_lotes").delete().eq("id", lote.id).eq("account_id", accountId);
    throw itemsError;
  }
  return { ok: true, lote };
}

export async function POST(request: NextRequest) {
  const guard = await guardAdminMutation(request, "admin_action_ip");
  if (guard) return guard;
  const context = await requireAccountContext();
  if (context.error) return context.error;
  const parsed = createLoteSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || "Campanha inválida." }, { status: 400 });
  const body = parsed.data;
  const groupJids = Array.from(new Set(body.group_jids));
  if (!groupJids.length || groupJids.some((jid) => !validateGroupJid(jid))) {
    return NextResponse.json({ error: "Escolha ao menos um grupo válido." }, { status: 400 });
  }
  if (body.scheduled_at && new Date(body.scheduled_at).getTime() < Date.now() - 60_000) {
    return NextResponse.json({ error: "Agendamento no passado." }, { status: 400 });
  }
  const sb = supabaseAdmin();
  try { return NextResponse.json(await createLoteFallback(sb, context.accountId, body, groupJids)); }
  catch (fallbackError: any) { return NextResponse.json({ error: fallbackError?.message || "Não foi possível criar o disparo." }, { status: 500 }); }
}
