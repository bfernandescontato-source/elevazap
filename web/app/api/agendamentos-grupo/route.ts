import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { guardAdminMutation, requireAdmin } from "@/lib/security";
import { supabaseAdmin } from "@/lib/supabase";

const editableStatuses = ["pendente", "pausado", "erro", "incerto", "cancelado"];

const rescheduleSchema = z.object({
  id: z.string().uuid().optional(),
  lote_id: z.string().uuid().optional(),
  scope: z.enum(["item", "lote"]).default("item"),
  scheduled_at: z.string().datetime().optional(),
  texto: z.string().optional(),
  legenda: z.string().optional()
});

const duplicateSchema = z.object({
  id: z.string().uuid().optional(),
  lote_id: z.string().uuid().optional(),
  scope: z.enum(["item", "lote"]).default("item"),
  scheduled_at: z.string().datetime()
});

function previewOf(item: any) {
  return item.texto || item.legenda || item.file_name || "Mensagem sem texto.";
}

function assertFutureDate(value?: string) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Data inválida.";
  if (date.getTime() < Date.now() - 60_000) return "Agendamento no passado.";
  return null;
}

async function loadLists() {
  const sb = supabaseAdmin();
  const { data: items, error } = await sb.from("envios_grupo").select("*").order("scheduled_at", { ascending: true }).limit(600);
  if (error) throw error;

  const loteIds = Array.from(new Set((items || []).map((item) => item.lote_id).filter(Boolean)));
  const senderIds = Array.from(new Set((items || []).map((item) => item.whatsapp_sender_id).filter(Boolean)));

  const [lotesResult, sendersResult] = await Promise.all([
    loteIds.length ? sb.from("envios_grupo_lotes").select("*").in("id", loteIds) : Promise.resolve({ data: [] as any[] }),
    senderIds.length ? sb.from("whatsapp_senders").select("id,label,session_name").in("id", senderIds) : Promise.resolve({ data: [] as any[] })
  ]);

  const lotes = new Map((lotesResult.data || []).map((lote: any) => [lote.id, lote]));
  const senders = new Map((sendersResult.data || []).map((sender: any) => [sender.id, sender]));

  return (items || []).map((item: any) => {
    const lote: any = lotes.get(item.lote_id) || {};
    const sender: any = senders.get(item.whatsapp_sender_id || lote.whatsapp_sender_id);
    return {
      ...item,
      lote_titulo: lote.titulo || "Lote sem nome",
      lote_status: lote.status || null,
      campanha_nome: item.campanha_nome || lote.campanha_nome || lote.titulo || "Sem campanha vinculada",
      campanha_id: item.campanha_id || lote.campanha_id || null,
      numero_responsavel: sender?.label || (item.whatsapp_session_name || lote.whatsapp_session_name ? "Número conectado" : "Número principal"),
      preview: previewOf(item)
    };
  });
}

export async function GET() {
  const guard = await requireAdmin();
  if (guard) return guard;
  try {
    return NextResponse.json({ agendamentos: await loadLists() });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  const guard = await guardAdminMutation(request, "agendamentos_grupo");
  if (guard) return guard;
  const parsed = rescheduleSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || "Dados inválidos." }, { status: 400 });

  const body = parsed.data;
  if (!body.id && !body.lote_id) return NextResponse.json({ error: "Informe o item ou lote." }, { status: 400 });
  const dateError = assertFutureDate(body.scheduled_at);
  if (dateError) return NextResponse.json({ error: dateError }, { status: 400 });

  const sb = supabaseAdmin();
  const update: Record<string, any> = { updated_at: new Date().toISOString() };
  if (body.scheduled_at) {
    update.scheduled_at = body.scheduled_at;
    update.status = "pendente";
    update.claim_token = null;
    update.next_attempt_at = null;
  }
  if (body.texto !== undefined) update.texto = body.texto;
  if (body.legenda !== undefined) update.legenda = body.legenda;

  if (body.scope === "lote") {
    if (!body.lote_id) return NextResponse.json({ error: "Informe o lote." }, { status: 400 });
    if (body.scheduled_at) {
      await sb.from("envios_grupo_lotes").update({ scheduled_at: body.scheduled_at, status: "pendente", updated_at: new Date().toISOString() }).eq("id", body.lote_id);
    }
    const { error } = await sb.from("envios_grupo").update(update).eq("lote_id", body.lote_id).in("status", editableStatuses);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    await sb.rpc("recalc_lote_counts", { p_lote_id: body.lote_id });
    return NextResponse.json({ ok: true });
  }

  if (!body.id) return NextResponse.json({ error: "Informe o item." }, { status: 400 });
  const { data: item } = await sb.from("envios_grupo").select("lote_id,status").eq("id", body.id).maybeSingle();
  if (!item) return NextResponse.json({ error: "Agendamento não encontrado." }, { status: 404 });
  if (!editableStatuses.includes(item.status)) return NextResponse.json({ error: "Mensagem já enviada ou em processamento. Use duplicar para reaproveitar." }, { status: 400 });
  const { error } = await sb.from("envios_grupo").update(update).eq("id", body.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (item.lote_id) await sb.rpc("recalc_lote_counts", { p_lote_id: item.lote_id });
  return NextResponse.json({ ok: true });
}

export async function POST(request: NextRequest) {
  const guard = await guardAdminMutation(request, "agendamentos_grupo_duplicate");
  if (guard) return guard;
  const parsed = duplicateSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || "Dados inválidos." }, { status: 400 });

  const body = parsed.data;
  const dateError = assertFutureDate(body.scheduled_at);
  if (dateError) return NextResponse.json({ error: dateError }, { status: 400 });
  const sb = supabaseAdmin();

  if (body.scope === "lote") {
    if (!body.lote_id) return NextResponse.json({ error: "Informe o lote." }, { status: 400 });
    const { data: lote } = await sb.from("envios_grupo_lotes").select("*").eq("id", body.lote_id).maybeSingle();
    const { data: items } = await sb.from("envios_grupo").select("*").eq("lote_id", body.lote_id);
    if (!lote || !items?.length) return NextResponse.json({ error: "Lote não encontrado." }, { status: 404 });

    const { data: newLote, error: loteError } = await sb.from("envios_grupo_lotes").insert({
      titulo: `Cópia - ${lote.titulo || "Lote"}`,
      campanha_id: lote.campanha_id,
      campanha_nome: lote.campanha_nome,
      whatsapp_sender_id: lote.whatsapp_sender_id,
      whatsapp_session_name: lote.whatsapp_session_name,
      tipo: lote.tipo,
      texto: lote.texto,
      legenda: lote.legenda,
      mention_all: Boolean(lote.mention_all),
      media_bucket: lote.media_bucket,
      media_path: lote.media_path,
      file_name: lote.file_name,
      mime_type: lote.mime_type,
      file_size_bytes: lote.file_size_bytes,
      total: items.length,
      pendentes: items.length,
      scheduled_at: body.scheduled_at
    }).select("*").single();
    if (loteError) return NextResponse.json({ error: loteError.message }, { status: 500 });

    const rows = items.map((item: any) => ({
      lote_id: newLote.id,
      campanha_id: item.campanha_id || lote.campanha_id,
      campanha_nome: item.campanha_nome || lote.campanha_nome,
      whatsapp_sender_id: item.whatsapp_sender_id || lote.whatsapp_sender_id,
      whatsapp_session_name: item.whatsapp_session_name || lote.whatsapp_session_name,
      group_jid: item.group_jid,
      nome_grupo: item.nome_grupo,
      tipo: item.tipo,
      texto: item.texto,
      legenda: item.legenda,
      mention_all: Boolean(item.mention_all),
      media_bucket: item.media_bucket,
      media_path: item.media_path,
      file_name: item.file_name,
      mime_type: item.mime_type,
      file_size_bytes: item.file_size_bytes,
      status: "pendente",
      scheduled_at: body.scheduled_at
    }));
    const inserted = await sb.from("envios_grupo").insert(rows);
    if (inserted.error) return NextResponse.json({ error: inserted.error.message }, { status: 500 });
    return NextResponse.json({ ok: true, lote: newLote });
  }

  if (!body.id) return NextResponse.json({ error: "Informe o item." }, { status: 400 });
  const { data: item } = await sb.from("envios_grupo").select("*").eq("id", body.id).maybeSingle();
  if (!item) return NextResponse.json({ error: "Agendamento não encontrado." }, { status: 404 });

  const { data: newLote, error: loteError } = await sb.from("envios_grupo_lotes").insert({
    titulo: `Cópia - ${item.nome_grupo || "Mensagem agendada"}`,
    campanha_id: item.campanha_id,
    campanha_nome: item.campanha_nome,
    whatsapp_sender_id: item.whatsapp_sender_id,
    whatsapp_session_name: item.whatsapp_session_name,
    tipo: item.tipo,
    texto: item.texto,
    legenda: item.legenda,
    mention_all: Boolean(item.mention_all),
    media_bucket: item.media_bucket,
    media_path: item.media_path,
    file_name: item.file_name,
    mime_type: item.mime_type,
    file_size_bytes: item.file_size_bytes,
    total: 1,
    pendentes: 1,
    scheduled_at: body.scheduled_at
  }).select("*").single();
  if (loteError) return NextResponse.json({ error: loteError.message }, { status: 500 });

  const inserted = await sb.from("envios_grupo").insert({
    lote_id: newLote.id,
    campanha_id: item.campanha_id,
    campanha_nome: item.campanha_nome,
    whatsapp_sender_id: item.whatsapp_sender_id,
    whatsapp_session_name: item.whatsapp_session_name,
    group_jid: item.group_jid,
    nome_grupo: item.nome_grupo,
    tipo: item.tipo,
    texto: item.texto,
    legenda: item.legenda,
    mention_all: Boolean(item.mention_all),
    media_bucket: item.media_bucket,
    media_path: item.media_path,
    file_name: item.file_name,
    mime_type: item.mime_type,
    file_size_bytes: item.file_size_bytes,
    status: "pendente",
    scheduled_at: body.scheduled_at
  });
  if (inserted.error) return NextResponse.json({ error: inserted.error.message }, { status: 500 });
  return NextResponse.json({ ok: true, lote: newLote });
}
