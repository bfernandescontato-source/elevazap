import { NextRequest, NextResponse } from "next/server";
import { createLoteSchema } from "@/lib/schemas";
import { validateGroupJid } from "@/lib/phone";
import { guardAdminMutation } from "@/lib/security";
import { supabaseAdmin } from "@/lib/supabase";

export async function POST(request: NextRequest) {
  const guard = await guardAdminMutation(request, "admin_action_ip");
  if (guard) return guard;
  const parsed = createLoteSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Lote inválido." }, { status: 400 });
  const body = parsed.data;
  if (body.group_jids.some((jid) => !validateGroupJid(jid))) return NextResponse.json({ error: "Grupo inválido." }, { status: 400 });
  if (body.scheduled_at && new Date(body.scheduled_at).getTime() < Date.now() - 60000) return NextResponse.json({ error: "Agendamento no passado." }, { status: 400 });
  const sb = supabaseAdmin();
  const { data: grupos } = await sb.from("grupos").select("group_jid,nome").in("group_jid", body.group_jids);
  const scheduled_at = body.scheduled_at || new Date().toISOString();
  const media = body.media;
  const { data: lote, error } = await sb.from("envios_grupo_lotes").insert({
    titulo: body.titulo,
    tipo: body.tipo,
    texto: body.texto,
    legenda: body.legenda,
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
    group_jid: jid,
    nome_grupo: grupos?.find((g) => g.group_jid === jid)?.nome || jid,
    tipo: body.tipo,
    texto: body.texto,
    legenda: body.legenda,
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
