import { NextRequest, NextResponse } from "next/server";
import { createLoteSchema } from "@/lib/schemas";
import { validateGroupJid } from "@/lib/phone";
import { guardAdminMutation } from "@/lib/security";
import { supabaseAdmin } from "@/lib/supabase";

export async function POST(request: NextRequest) {
  const guard = await guardAdminMutation(request, "admin_action_ip");
  if (guard) return guard;
  const parsed = createLoteSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || "Lote inválido." }, { status: 400 });
  const body = parsed.data;
  if (body.group_jids.some((jid) => !validateGroupJid(jid))) return NextResponse.json({ error: "Grupo inválido." }, { status: 400 });
  if (body.scheduled_at && new Date(body.scheduled_at).getTime() < Date.now() - 60000) return NextResponse.json({ error: "Agendamento no passado." }, { status: 400 });
  const sb = supabaseAdmin();
  const { data: grupos } = await sb.from("grupos").select("group_jid,nome").in("group_jid", body.group_jids);
  const { data: campanha } = body.campanha_id
    ? await sb.from("campanhas").select("id,nome").eq("id", body.campanha_id).maybeSingle()
    : { data: null } as any;
  if (body.campanha_id && !campanha) return NextResponse.json({ error: "Campanha não encontrada." }, { status: 400 });
  const { data: sender } = body.whatsapp_sender_id
    ? await sb.from("whatsapp_senders").select("*").eq("id", body.whatsapp_sender_id).maybeSingle()
    : { data: null } as any;
  if (body.whatsapp_sender_id && !sender) return NextResponse.json({ error: "Número responsável pelo disparo não encontrado." }, { status: 400 });
  const scheduled_at = body.scheduled_at || new Date().toISOString();
  const media = body.media;
  const { data: lote, error } = await sb.from("envios_grupo_lotes").insert({
    titulo: body.titulo,
    campanha_id: campanha?.id,
    campanha_nome: campanha?.nome,
    whatsapp_sender_id: sender?.id,
    whatsapp_session_name: sender?.session_name,
    tipo: body.tipo,
    texto: body.texto,
    legenda: body.legenda,
    mention_all: Boolean(body.mention_all),
    media_bucket: media?.bucket,
    media_path: media?.storage_path,
    file_name: media?.file_name,
    mime_type: media?.mime_type,
    file_size_bytes: media?.file_size_bytes,
    total: body.group_jids.length,
    pendentes: body.group_jids.length,
    scheduled_at
  }).select("*").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const items = body.group_jids.map((jid) => ({
    lote_id: lote.id,
    campanha_id: campanha?.id,
    campanha_nome: campanha?.nome,
    whatsapp_sender_id: sender?.id,
    whatsapp_session_name: sender?.session_name,
    group_jid: jid,
    nome_grupo: grupos?.find((g) => g.group_jid === jid)?.nome || jid,
    tipo: body.tipo,
    texto: body.texto,
    legenda: body.legenda,
    mention_all: Boolean(body.mention_all),
    media_bucket: media?.bucket,
    media_path: media?.storage_path,
    file_name: media?.file_name,
    mime_type: media?.mime_type,
    file_size_bytes: media?.file_size_bytes,
    scheduled_at
  }));
  const inserted = await sb.from("envios_grupo").insert(items);
  if (inserted.error) return NextResponse.json({ error: inserted.error.message }, { status: 500 });
  return NextResponse.json({ ok: true, lote });
}
