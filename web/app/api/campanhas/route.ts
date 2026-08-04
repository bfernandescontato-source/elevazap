import { NextRequest, NextResponse } from "next/server";
import { createCampanhaSchema, updateCampanhaSchema } from "@/lib/schemas";
import { validateGroupJid } from "@/lib/phone";
import { guardAdminMutation, requireAdmin } from "@/lib/security";
import { supabaseAdmin } from "@/lib/supabase";

export async function GET() {
  const guard = await requireAdmin();
  if (guard) return guard;
  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("campanhas")
    .select("id,nome,whatsapp_sender_id,created_at,whatsapp_senders(id,label,session_name),campanha_grupos(group_jid,grupos(group_jid,nome,qtd_membros,sou_admin,foto_url))")
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
  const parsed = createCampanhaSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Campanha inválida." }, { status: 400 });
  const body = parsed.data;
  const groupJids = Array.from(new Set(body.group_jids));
  if (groupJids.some((jid) => !validateGroupJid(jid))) return NextResponse.json({ error: "Grupo inválido." }, { status: 400 });

  const sb = supabaseAdmin();
  const { data, error } = await sb.rpc("create_campaign_atomic", {
    p_nome: body.nome,
    p_group_jids: groupJids,
    p_sender_id: body.whatsapp_sender_id || null
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function PATCH(request: NextRequest) {
  const guard = await guardAdminMutation(request, "campanhas_ip");
  if (guard) return guard;
  const parsed = updateCampanhaSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Campanha inválida." }, { status: 400 });
  const body = parsed.data;
  const sb = supabaseAdmin();

  if (body.nome) {
    const { error } = await sb.from("campanhas").update({ nome: body.nome, updated_at: new Date().toISOString() }).eq("id", body.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (body.whatsapp_sender_id !== undefined) {
    const { error } = await sb.from("campanhas").update({ whatsapp_sender_id: body.whatsapp_sender_id, updated_at: new Date().toISOString() }).eq("id", body.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (body.group_jids) {
    const groupJids = Array.from(new Set(body.group_jids));
    if (groupJids.some((jid) => !validateGroupJid(jid))) return NextResponse.json({ error: "Grupo inválido." }, { status: 400 });
    const { error } = await sb.rpc("replace_campaign_groups_atomic", { p_campanha_id: body.id, p_group_jids: groupJids });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(request: NextRequest) {
  const guard = await guardAdminMutation(request, "campanhas_ip");
  if (guard) return guard;
  const { id } = await request.json();
  if (!id) return NextResponse.json({ error: "Campanha inválida." }, { status: 400 });
  const { error } = await supabaseAdmin().from("campanhas").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
