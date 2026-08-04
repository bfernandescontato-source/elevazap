import { NextRequest, NextResponse } from "next/server";
import { createLoteSchema } from "@/lib/schemas";
import { validateGroupJid } from "@/lib/phone";
import { guardAdminMutation } from "@/lib/security";
import { supabaseAdmin } from "@/lib/supabase";

export async function POST(request: NextRequest) {
  const guard = await guardAdminMutation(request, "admin_action_ip");
  if (guard) return guard;
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
  const { data, error } = await supabaseAdmin().rpc("create_group_lote_atomic", {
    p_titulo: body.titulo,
    p_campanha_id: body.campanha_id || null,
    p_group_jids: groupJids,
    p_sender_id: body.whatsapp_sender_id || null,
    p_tipo: body.tipo,
    p_texto: body.texto || null,
    p_legenda: body.legenda || null,
    p_mention_all: Boolean(body.mention_all),
    p_scheduled_at: body.scheduled_at || new Date().toISOString(),
    p_media: body.media || null
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
