import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { guardAdminMutation, requireAccountContext } from "@/lib/security";
import { validateGroupJid } from "@/lib/phone";
import { supabaseAdmin } from "@/lib/supabase";
import { planSenderSplit } from "@/modules/dispatch-capacity/server/split-service";

const scheduleItemSchema = z.object({
  modelo_id: z.string().uuid(),
  scheduled_at: z.string().datetime()
});

const bulkScheduleSchema = z.object({
  nome: z.string().trim().min(1).max(120),
  campanha_id: z.string().uuid().optional(),
  group_jids: z.array(z.string()).min(1).max(500),
  whatsapp_sender_id: z.string().uuid().optional(),
  // "Dividir os grupos entre meus números" (opt-in): 1 lote por número em cada horário.
  split_across_senders: z.boolean().optional(),
  schedules: z.array(scheduleItemSchema).min(1).max(300)
});

export async function POST(request: NextRequest) {
  const guard = await guardAdminMutation(request, "admin_action_ip");
  if (guard) return guard;
  const context = await requireAccountContext();
  if (context.error) return context.error;

  const parsed = bulkScheduleSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || "Dados inválidos." }, { status: 400 });

  const { nome, campanha_id, group_jids, whatsapp_sender_id, split_across_senders, schedules } = parsed.data;
  const groupJids = Array.from(new Set(group_jids.filter(validateGroupJid)));
  if (!groupJids.length) return NextResponse.json({ error: "Nenhum grupo válido selecionado." }, { status: 400 });

  const modeloIds = Array.from(new Set(schedules.map((s) => s.modelo_id)));
  const sb = supabaseAdmin();
  const { accountId } = context;

  // Validate groups belong to account
  const { data: groups, error: groupsError } = await sb.from("grupos").select("group_jid,nome").eq("account_id", accountId).in("group_jid", groupJids);
  if (groupsError) return NextResponse.json({ error: groupsError.message }, { status: 500 });
  if ((groups || []).length !== groupJids.length) return NextResponse.json({ error: "Um ou mais grupos não pertencem à sua conta." }, { status: 400 });

  // Validate models belong to account
  const { data: modelos, error: modelosError } = await sb.from("modelos_mensagem").select("*").eq("account_id", accountId).in("id", modeloIds);
  if (modelosError) return NextResponse.json({ error: modelosError.message }, { status: 500 });
  if ((modelos || []).length !== modeloIds.length) return NextResponse.json({ error: "Um ou mais modelos não pertencem à sua conta." }, { status: 400 });

  const modeloMap = new Map((modelos || []).map((m: any) => [m.id, m]));
  const groupByJid = new Map((groups || []).map((g: any) => [g.group_jid, g]));

  // Sender is always resolved at dispatch time: explicit selection > first account sender.
  // Campaign sender is never inherited — dispatch number must be chosen by the user.
  // whatsapp_session_name must NOT be null or the queue will skip the row.
  let sender: any = null;
  if (whatsapp_sender_id) {
    const { data: senderData, error: senderError } = await sb.from("whatsapp_senders").select("id,session_name").eq("id", whatsapp_sender_id).eq("account_id", accountId).maybeSingle();
    if (senderError) return NextResponse.json({ error: senderError.message }, { status: 500 });
    if (!senderData) return NextResponse.json({ error: "Número responsável não encontrado." }, { status: 400 });
    sender = senderData;
  }

  // Validate campaign belongs to account
  if (campanha_id) {
    const { data: camp } = await sb.from("campanhas").select("id").eq("id", campanha_id).eq("account_id", accountId).maybeSingle();
    if (!camp) return NextResponse.json({ error: "Campanha não encontrada." }, { status: 400 });
  }

  // Fallback: first available sender for the account
  if (!sender) {
    const { data: fallbackSender } = await sb.from("whatsapp_senders").select("id,session_name").eq("account_id", accountId).order("created_at", { ascending: true }).limit(1).maybeSingle();
    if (!fallbackSender) return NextResponse.json({ error: "Nenhum número WhatsApp conectado. Adicione um número em Configurações." }, { status: 400 });
    sender = fallbackSender;
  }

  // Validate no model is empty
  for (const item of schedules) {
    const modelo = modeloMap.get(item.modelo_id);
    if (!modelo) continue;
    if (!modelo.texto && !modelo.media_path) return NextResponse.json({ error: `Modelo "${modelo.nome}" não tem conteúdo.` }, { status: 400 });
    if (modelo.tipo !== "texto" && !modelo.media_path) return NextResponse.json({ error: `Modelo "${modelo.nome}" não tem mídia obrigatória.` }, { status: 400 });
  }

  // Partes do envio: sem divisão, todos os grupos com o número escolhido. Com divisão,
  // cada número recebe só os grupos em que está (planSenderSplit nunca dá grupo a quem não está nele).
  let parts: Array<{ sender: { id: string; session_name: string | null }; jids: string[] }> = [{ sender, jids: groupJids }];
  if (split_across_senders) {
    try {
      const plan = await planSenderSplit(accountId, sender.id, groupJids);
      if (plan.sendersUsed > 1) {
        parts = plan.shares.map((share) => ({
          sender: share.senderId === sender.id ? sender : { id: share.senderId, session_name: plan.senders.get(share.senderId)?.session_name ?? null },
          jids: plan.assignments.get(share.senderId) || []
        }));
        if (parts.some((part) => !part.sender.session_name)) return NextResponse.json({ error: "Um dos números está sem sessão. Atualize a página e tente de novo." }, { status: 400 });
      }
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : "Não foi possível dividir os grupos entre os números." }, { status: 500 });
    }
  }

  // Create bulk_schedule record
  const firstAt = schedules[0].scheduled_at;
  const nextAt = schedules.find((s) => new Date(s.scheduled_at) > new Date())?.scheduled_at || firstAt;
  const { data: bulkSchedule, error: bulkError } = await sb.from("bulk_schedules").insert({
    account_id: accountId,
    nome,
    campanha_id: campanha_id || null,
    status: "programado",
    total: schedules.length,
    agendados: schedules.length,
    primeiro_envio_at: firstAt,
    proximo_envio_at: nextAt
  }).select("id").single();
  if (bulkError) return NextResponse.json({ error: bulkError.message }, { status: 500 });

  const bulkScheduleId = bulkSchedule.id;
  const lotesCreated: string[] = [];

  let itemsCreated = 0;
  // Create one lote per scheduled item (and per number when splitting)
  for (const item of schedules) {
    const modelo = modeloMap.get(item.modelo_id);
    if (!modelo) continue;
    for (const part of parts) {
      const partSender = part.sender;

      const { data: lote, error: loteError } = await sb.from("envios_grupo_lotes").insert({
        account_id: accountId,
        titulo: modelo.nome,
        campanha_id: campanha_id || null,
        modelo_mensagem_id: modelo.id,
        bulk_schedule_id: bulkScheduleId,
        whatsapp_sender_id: partSender.id,
        whatsapp_session_name: partSender.session_name || null,
        tipo: modelo.tipo,
        texto: modelo.texto || null,
        legenda: (modelo.tipo === "imagem" || modelo.tipo === "video") ? modelo.texto || null : null,
        mention_all: false,
        media_bucket: modelo.media_bucket || null,
        media_path: modelo.media_path || null,
        file_name: modelo.file_name || null,
        mime_type: modelo.mime_type || null,
        file_size_bytes: modelo.file_size_bytes || null,
        priority: "high",
        total: part.jids.length,
        pendentes: part.jids.length,
        scheduled_at: item.scheduled_at
      }).select("id").single();

      if (loteError) {
        // Clean up: cancel already created lotes and the bulk_schedule
        if (lotesCreated.length) {
          await sb.from("envios_grupo_lotes").delete().in("id", lotesCreated).eq("account_id", accountId);
        }
        await sb.from("bulk_schedules").delete().eq("id", bulkScheduleId).eq("account_id", accountId);
        return NextResponse.json({ error: `Erro ao criar lote para "${modelo.nome}": ${loteError.message}` }, { status: 500 });
      }

      const { error: itemsError } = await sb.from("envios_grupo").insert(
        part.jids.map((jid) => ({
          account_id: accountId,
          lote_id: lote.id,
          whatsapp_sender_id: partSender.id,
          whatsapp_session_name: partSender.session_name || null,
          group_jid: jid,
          nome_grupo: groupByJid.get(jid)?.nome || jid,
          tipo: modelo.tipo,
          texto: modelo.texto || null,
          legenda: (modelo.tipo === "imagem" || modelo.tipo === "video") ? modelo.texto || null : null,
          mention_all: false,
          media_bucket: modelo.media_bucket || null,
          media_path: modelo.media_path || null,
          file_name: modelo.file_name || null,
          mime_type: modelo.mime_type || null,
          file_size_bytes: modelo.file_size_bytes || null,
          priority: "high",
          scheduled_at: item.scheduled_at
        }))
      );

      if (itemsError) {
        await sb.from("envios_grupo_lotes").delete().eq("id", lote.id).eq("account_id", accountId);
        if (lotesCreated.length) {
          await sb.from("envios_grupo_lotes").delete().in("id", lotesCreated).eq("account_id", accountId);
        }
        await sb.from("bulk_schedules").delete().eq("id", bulkScheduleId).eq("account_id", accountId);
        return NextResponse.json({ error: `Erro ao criar envios para "${modelo.nome}".` }, { status: 500 });
      }

      lotesCreated.push(lote.id);
    }
    itemsCreated += 1;
  }

  return NextResponse.json({ ok: true, bulk_schedule_id: bulkScheduleId, total: itemsCreated, lotes: lotesCreated.length, senders: parts.length });
}
