import { supabaseAdmin } from "@/lib/supabase";
import { validateMedia } from "@/lib/schemas";
import { MAX_RECURRING_MESSAGES } from "../schedule";
import type { RecurringMessageInput } from "../schemas";

export class RecurringMessageError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

const COLUMNS = "id,nome,tipo,texto,media_bucket,media_path,file_name,mime_type,file_size_bytes,whatsapp_sender_id,group_jids,horarios,dias_semana,ativo,last_error,created_at,updated_at";

export type RecurringMessage = {
  id: string; nome: string; tipo: "texto" | "imagem"; texto: string;
  media: { bucket: string; storage_path: string; file_name: string; mime_type: string; file_size_bytes: number } | null;
  whatsapp_sender_id: string | null; group_jids: string[]; horarios: string[]; dias_semana: number[];
  ativo: boolean; last_error: string | null; created_at: string; updated_at: string;
};

function toMessage(row: any): RecurringMessage {
  return {
    id: row.id, nome: row.nome, tipo: row.tipo, texto: row.texto || "",
    media: row.media_bucket && row.media_path ? { bucket: row.media_bucket, storage_path: row.media_path, file_name: row.file_name || "imagem", mime_type: row.mime_type || "image/jpeg", file_size_bytes: Number(row.file_size_bytes || 1) } : null,
    whatsapp_sender_id: row.whatsapp_sender_id, group_jids: row.group_jids || [],
    horarios: (row.horarios || []).map((time: string) => String(time).slice(0, 5)),
    dias_semana: (row.dias_semana || []).map(Number), ativo: Boolean(row.ativo), last_error: row.last_error || null,
    created_at: row.created_at, updated_at: row.updated_at
  };
}

function missingSchema(error: any) {
  return ["42P01", "PGRST205", "PGRST202", "42883"].includes(error?.code || "");
}

function fail(error: any, fallback: string): never {
  if (missingSchema(error)) throw new RecurringMessageError("Mensagens automáticas ainda não estão disponíveis. Tente mais tarde.", 503);
  if (error?.code === "23514" && /Limite de 5/.test(error.message || "")) throw new RecurringMessageError(`Você pode ter até ${MAX_RECURRING_MESSAGES} mensagens automáticas.`, 409);
  throw new RecurringMessageError(fallback, 500);
}

export async function listRecurringMessages(accountId: string) {
  const { data, error } = await supabaseAdmin().from("recurring_group_messages").select(COLUMNS)
    .eq("account_id", accountId).order("created_at", { ascending: true }).limit(MAX_RECURRING_MESSAGES);
  if (error) fail(error, "Não foi possível carregar as mensagens automáticas.");
  return (data || []).map(toMessage);
}

/** Próximos lotes já criados (hoje e amanhã), com a situação de cada um. */
export async function listUpcomingRuns(accountId: string) {
  const { data, error } = await supabaseAdmin().from("recurring_group_message_runs")
    .select("recurring_message_id,local_date,local_time,scheduled_at,lote_id,envios_grupo_lotes(status,total,enviados,erros)")
    .eq("account_id", accountId).gte("scheduled_at", new Date(Date.now() - 12 * 3600_000).toISOString())
    .order("scheduled_at", { ascending: true }).limit(100);
  if (error) fail(error, "Não foi possível carregar os próximos envios.");
  return (data || []).map((row: any) => {
    const lote = Array.isArray(row.envios_grupo_lotes) ? row.envios_grupo_lotes[0] : row.envios_grupo_lotes;
    return { messageId: row.recurring_message_id, localDate: row.local_date, localTime: String(row.local_time).slice(0, 5), scheduledAt: row.scheduled_at, loteId: row.lote_id, status: lote?.status || null, total: Number(lote?.total || 0), sent: Number(lote?.enviados || 0), failed: Number(lote?.erros || 0) };
  });
}

/** O número e os grupos precisam ser desta conta; a imagem precisa ter vindo do upload desta conta. */
async function validateTargets(accountId: string, input: RecurringMessageInput) {
  const sb = supabaseAdmin();
  const { data: sender, error: senderError } = await sb.from("whatsapp_senders").select("id,session_name")
    .eq("id", input.whatsapp_sender_id).eq("account_id", accountId).maybeSingle();
  if (senderError) fail(senderError, "Não foi possível conferir o número.");
  if (!sender?.session_name) throw new RecurringMessageError("Número não encontrado.");
  const { data: groups, error: groupsError } = await sb.from("grupos").select("group_jid")
    .eq("account_id", accountId).in("group_jid", input.group_jids);
  if (groupsError) fail(groupsError, "Não foi possível conferir os grupos.");
  if ((groups || []).length !== input.group_jids.length) throw new RecurringMessageError("Um ou mais grupos não foram encontrados.");
  if (input.tipo === "imagem") {
    const media = input.media!;
    if (!media.storage_path.startsWith(`accounts/${accountId}/uploads/`)) throw new RecurringMessageError("Imagem inválida.");
    const valid = validateMedia("imagem", media.mime_type, media.file_size_bytes);
    if (!valid.ok) throw new RecurringMessageError(valid.error || "Imagem inválida.");
  }
}

function rowFrom(input: RecurringMessageInput) {
  const media = input.tipo === "imagem" ? input.media : null;
  return {
    nome: input.nome, tipo: input.tipo, texto: input.texto,
    media_bucket: media?.bucket || null, media_path: media?.storage_path || null, file_name: media?.file_name || null,
    mime_type: media?.mime_type || null, file_size_bytes: media?.file_size_bytes || null,
    whatsapp_sender_id: input.whatsapp_sender_id, group_jids: input.group_jids, horarios: input.horarios,
    dias_semana: input.dias_semana, ativo: input.ativo
  };
}

/** Cria os lotes de hoje e amanhã. Falha aqui não perde nada: o laço periódico tenta de novo. */
async function materialize(accountId: string, id: string) {
  const { data, error } = await supabaseAdmin().rpc("materialize_recurring_group_message", { p_account_id: accountId, p_message_id: id });
  if (error) {
    console.error({ event: "recurring_message.materialize_failed", message_id: id, code: error.code, error: error.message });
    return 0;
  }
  return Number(data || 0);
}

/** Cancela o que ainda não começou a sair, para não mandar texto antigo. */
async function cancelPending(accountId: string, id: string) {
  const { error } = await supabaseAdmin().rpc("cancel_pending_recurring_group_message_runs", { p_account_id: accountId, p_message_id: id });
  if (error) fail(error, "Não foi possível atualizar os envios já programados.");
}

export async function createRecurringMessage(accountId: string, input: RecurringMessageInput) {
  await validateTargets(accountId, input);
  const { count, error: countError } = await supabaseAdmin().from("recurring_group_messages")
    .select("id", { count: "exact", head: true }).eq("account_id", accountId);
  if (countError) fail(countError, "Não foi possível salvar a mensagem.");
  if ((count || 0) >= MAX_RECURRING_MESSAGES) throw new RecurringMessageError(`Você pode ter até ${MAX_RECURRING_MESSAGES} mensagens automáticas.`, 409);
  const { data, error } = await supabaseAdmin().from("recurring_group_messages")
    .insert({ account_id: accountId, ...rowFrom(input) }).select(COLUMNS).single();
  if (error) fail(error, "Não foi possível salvar a mensagem.");
  const scheduled = await materialize(accountId, data.id);
  return { message: toMessage(data), scheduled };
}

export async function updateRecurringMessage(accountId: string, id: string, input: RecurringMessageInput) {
  await validateTargets(accountId, input);
  const { data, error } = await supabaseAdmin().from("recurring_group_messages")
    .update({ ...rowFrom(input), materialized_through: null, last_error: null, updated_at: new Date().toISOString() })
    .eq("id", id).eq("account_id", accountId).select(COLUMNS).maybeSingle();
  if (error) fail(error, "Não foi possível salvar a mensagem.");
  if (!data) throw new RecurringMessageError("Mensagem não encontrada.", 404);
  await cancelPending(accountId, id);
  const scheduled = await materialize(accountId, id);
  return { message: toMessage(data), scheduled };
}

export async function toggleRecurringMessage(accountId: string, id: string, ativo: boolean) {
  const { data, error } = await supabaseAdmin().from("recurring_group_messages")
    .update({ ativo, materialized_through: null, updated_at: new Date().toISOString() })
    .eq("id", id).eq("account_id", accountId).select(COLUMNS).maybeSingle();
  if (error) fail(error, "Não foi possível mudar a mensagem.");
  if (!data) throw new RecurringMessageError("Mensagem não encontrada.", 404);
  await cancelPending(accountId, id);
  const scheduled = ativo ? await materialize(accountId, id) : 0;
  return { message: toMessage(data), scheduled };
}

export async function deleteRecurringMessage(accountId: string, id: string) {
  const { data, error } = await supabaseAdmin().from("recurring_group_messages").select("id").eq("id", id).eq("account_id", accountId).maybeSingle();
  if (error) fail(error, "Não foi possível apagar a mensagem.");
  if (!data) throw new RecurringMessageError("Mensagem não encontrada.", 404);
  await cancelPending(accountId, id);
  const { error: deleteError } = await supabaseAdmin().from("recurring_group_messages").delete().eq("id", id).eq("account_id", accountId);
  if (deleteError) fail(deleteError, "Não foi possível apagar a mensagem.");
}
