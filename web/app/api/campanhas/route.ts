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
  const { data: existingGroups, error: groupError } = await sb.from("grupos").select("group_jid").in("group_jid", groupJids);
  if (groupError) return NextResponse.json({ error: groupError.message }, { status: 500 });
  if ((existingGroups || []).length !== groupJids.length) return NextResponse.json({ error: "Um ou mais grupos não foram encontrados." }, { status: 400 });

  const { data: campanha, error } = await sb.from("campanhas").insert({ nome: body.nome, whatsapp_sender_id: body.whatsapp_sender_id || null }).select("*").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const rows = groupJids.map((group_jid, index) => ({ campanha_id: campanha.id, group_jid, position: index + 1 }));
  const linked = await sb.from("campanha_grupos").insert(rows);
  if (linked.error) return NextResponse.json({ error: linked.error.message }, { status: 500 });
  return NextResponse.json({ ok: true, campanha });
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
    const { data: existingGroups, error: groupError } = await sb.from("grupos").select("group_jid").in("group_jid", groupJids);
    if (groupError) return NextResponse.json({ error: groupError.message }, { status: 500 });
    if ((existingGroups || []).length !== groupJids.length) return NextResponse.json({ error: "Um ou mais grupos não foram encontrados." }, { status: 400 });
    const { data: currentRows, error: currentError } = await sb.from("campanha_grupos").select("group_jid").eq("campanha_id", body.id);
    if (currentError) return NextResponse.json({ error: currentError.message }, { status: 500 });
    const currentJids = new Set((currentRows || []).map((item) => item.group_jid));
    const nextJids = new Set(groupJids);
    const removedJids = Array.from(currentJids).filter((jid) => !nextJids.has(jid));
    const addedJids = groupJids.filter((jid) => !currentJids.has(jid));
    if (removedJids.length) {
      const removed = await sb.from("campanha_grupos").delete().eq("campanha_id", body.id).in("group_jid", removedJids);
      if (removed.error) return NextResponse.json({ error: removed.error.message }, { status: 500 });
    }
    if (addedJids.length) {
      const rows = addedJids.map((group_jid) => ({ campanha_id: body.id, group_jid, position: groupJids.indexOf(group_jid) + 1 }));
      const linked = await sb.from("campanha_grupos").insert(rows);
      if (linked.error) return NextResponse.json({ error: linked.error.message }, { status: 500 });
    }
    for (let index = 0; index < groupJids.length; index += 1) {
      const ordered = await sb.from("campanha_grupos").update({ position: index + 1, updated_at: new Date().toISOString() }).eq("campanha_id", body.id).eq("group_jid", groupJids[index]);
      if (ordered.error) return NextResponse.json({ error: ordered.error.message }, { status: 500 });
    }
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
