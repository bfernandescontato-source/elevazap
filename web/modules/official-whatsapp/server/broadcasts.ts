import { supabaseAdmin } from "@/lib/supabase";
import { appUrl, env } from "@/lib/env";
import { startFlow } from "./flow-processor";
import { findPhonesWithPriorRun } from "./flow-runs";
import { type ValidContact } from "./broadcast-contacts";
import { officialErrorCode, officialErrorMessage, officialErrorMetaDetails } from "./errors";

export async function createBroadcastAndStart(input: {
  name: string;
  flowId: string;
  contacts: ValidContact[];
  skipRecipientsWithPriorRun: boolean;
}) {
  const admin = supabaseAdmin();
  const priorPhones = input.skipRecipientsWithPriorRun
    ? await findPhonesWithPriorRun(input.flowId, input.contacts.map((contact) => contact.phone))
    : new Set<string>();

  const { data: broadcast, error } = await admin.from("official_broadcasts").insert({
    name: input.name,
    flow_id: input.flowId,
    status: "processing",
    total_rows: input.contacts.length,
    valid_recipients: input.contacts.length,
    skip_recipients_with_prior_run: input.skipRecipientsWithPriorRun,
    started_at: new Date().toISOString(),
    last_batch_at: new Date().toISOString()
  }).select("id").single();
  if (error) throw error;

  const rows = input.contacts.map((contact) => ({
    broadcast_id: broadcast.id,
    phone: contact.phone,
    row_data: { name: contact.name, email: contact.email, product: contact.product },
    status: priorPhones.has(contact.phone) ? ("skipped" as const) : ("queued" as const)
  }));
  const { error: insertError } = await admin.from("official_broadcast_recipients").insert(rows);
  if (insertError) throw insertError;

  const skippedForPriorRun = rows.filter((row) => row.status === "skipped").length;
  if (skippedForPriorRun) {
    await admin.from("official_broadcasts").update({ processed: skippedForPriorRun }).eq("id", broadcast.id);
  }
  return { broadcastId: broadcast.id as string, skippedForPriorRun };
}

// Processa um lote pequeno (tamanho = OFFICIAL_BROADCAST_CONCURRENCY) e devolve se ainda há
// mais gente na fila. Reaproveita startFlow() inteiro — envio, log, flow_run, tudo já testado
// na fase A. Se algum envio do lote voltar 429 da Meta, pausa o disparo em vez de continuar
// batendo na API (fica pro admin retomar manualmente depois).
export async function processBroadcastBatch(broadcastId: string): Promise<{ hasMore: boolean }> {
  const admin = supabaseAdmin();
  const { data: broadcast, error: broadcastError } = await admin.from("official_broadcasts").select("*").eq("id", broadcastId).maybeSingle();
  if (broadcastError) throw broadcastError;
  if (!broadcast || broadcast.status !== "processing") return { hasMore: false };

  await admin.from("official_broadcasts").update({ last_batch_at: new Date().toISOString() }).eq("id", broadcastId);

  const concurrency = env().OFFICIAL_BROADCAST_CONCURRENCY || 5;
  const { data: batch, error: batchError } = await admin.from("official_broadcast_recipients")
    .select("*").eq("broadcast_id", broadcastId).eq("status", "queued").order("created_at", { ascending: true }).limit(concurrency);
  if (batchError) throw batchError;

  if (!batch?.length) {
    await admin.from("official_broadcasts").update({ status: "completed", completed_at: new Date().toISOString() }).eq("id", broadcastId);
    return { hasMore: false };
  }

  await admin.from("official_broadcast_recipients").update({ status: "processing" }).in("id", batch.map((recipient) => recipient.id));

  let rateLimited = false;
  let acceptedDelta = 0;
  let failedDelta = 0;

  await Promise.all(batch.map(async (recipient) => {
    const rowData = recipient.row_data as { name: string | null; email: string | null; product: string | null };
    try {
      const result = await startFlow({
        flowId: broadcast.flow_id,
        rawPhone: recipient.phone,
        context: { customerName: rowData.name, productName: rowData.product, customerEmail: rowData.email, customerPhone: recipient.phone, amountCents: null, paymentUrl: null, accessUrl: null },
        source: "broadcast",
        sourceReference: recipient.id
      });
      await admin.from("official_broadcast_recipients").update({
        status: "accepted", meta_message_id: result.messageId || null, flow_run_id: result.flowRunId, sent_at: new Date().toISOString()
      }).eq("id", recipient.id);
      acceptedDelta += 1;
    } catch (error) {
      const code = officialErrorCode(error);
      if (officialErrorMetaDetails(error)?.httpStatus === 429) rateLimited = true;
      const summary = `${code}: ${officialErrorMessage(error)}`.slice(0, 500);
      await admin.from("official_broadcast_recipients").update({ status: "failed", error: summary }).eq("id", recipient.id);
      failedDelta += 1;
    }
  }));

  await admin.from("official_broadcasts").update({
    processed: broadcast.processed + acceptedDelta + failedDelta,
    accepted: broadcast.accepted + acceptedDelta,
    failed: broadcast.failed + failedDelta,
    ...(rateLimited ? { status: "paused" } : {})
  }).eq("id", broadcastId);

  if (rateLimited) return { hasMore: false };
  const { count, error: countError } = await admin.from("official_broadcast_recipients").select("id", { count: "exact", head: true }).eq("broadcast_id", broadcastId).eq("status", "queued");
  // Se a contagem falhar (ex.: instabilidade pontual do Supabase), assume que pode haver mais
  // gente na fila em vez de encerrar o disparo em silêncio — o próximo lote confirma de verdade
  // consultando as linhas "queued" e marca "completed" só quando elas realmente acabarem.
  if (countError) {
    console.error(`[official-broadcast] falha ao contar fila do disparo ${broadcastId}:`, countError);
    return { hasMore: true };
  }
  return { hasMore: (count || 0) > 0 };
}

// Chamada dentro de after() pelas rotas (criar, process-batch, resume) — dispara o próximo lote
// sem bloquear a resposta. Autenticado com o mesmo INTERNAL_API_KEY já usado pra falar com o
// whatsapp-service, então não precisamos de um segredo novo.
// IMPORTANTE: precisa retornar/aguardar o fetch — after() só garante que o trabalho termina se
// esperar a promise dele. Sem o await aqui, a função podia ser encerrada antes do fetch sair.
export async function triggerBatchProcessing(broadcastId: string) {
  try {
    await fetch(`${appUrl()}/api/admin/official/broadcasts/${broadcastId}/process-batch`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-internal-api-key": env().INTERNAL_API_KEY }
    });
  } catch (error) {
    console.error(`[official-broadcast] falha ao encadear próximo lote do disparo ${broadcastId}:`, error);
  }
}

// Rede de segurança: chamada a cada poll da tela de progresso (admin com a aba aberta).
// Se o disparo está "processing" mas nenhum lote rodou nos últimos 15s, o encadeamento via
// after() morreu em silêncio (ex.: falha pontual do self-fetch) — reativa sem exigir
// pausar/continuar manual. Usa update condicional em last_batch_at como trava simples contra
// reativar um lote que já está rodando (evita disparo duplicado para o mesmo contato).
const STALL_THRESHOLD_MS = 15_000;

export async function nudgeBroadcastIfStalled(id: string) {
  const admin = supabaseAdmin();
  const { data: broadcast, error } = await admin.from("official_broadcasts").select("status,last_batch_at").eq("id", id).maybeSingle();
  if (error) throw error;
  if (!broadcast || broadcast.status !== "processing") return { nudged: false };

  const staleSince = new Date(Date.now() - STALL_THRESHOLD_MS).toISOString();
  const isStale = !broadcast.last_batch_at || broadcast.last_batch_at < staleSince;
  if (!isStale) return { nudged: false };

  // Reserva o "direito" de reativar atualizando last_batch_at antes de chamar — se duas
  // requisições concorrentes (dois polls) chegarem juntas, só uma vence a condição abaixo.
  const { data: claimed } = await admin.from("official_broadcasts")
    .update({ last_batch_at: new Date().toISOString() })
    .eq("id", id).eq("status", "processing")
    .or(`last_batch_at.is.null,last_batch_at.lt.${staleSince}`)
    .select("id");
  if (!claimed?.length) return { nudged: false };

  await triggerBatchProcessing(id);
  return { nudged: true };
}

export async function pauseBroadcast(id: string) {
  const admin = supabaseAdmin();
  const { error } = await admin.from("official_broadcasts").update({ status: "paused" }).eq("id", id).eq("status", "processing");
  if (error) throw error;
}

export async function resumeBroadcast(id: string) {
  const admin = supabaseAdmin();
  // Também renova last_batch_at aqui: evita que o poll (nudge) da tela de progresso dispare
  // um segundo encadeamento em paralelo ao que este resume acabou de iniciar via after().
  const { error } = await admin.from("official_broadcasts").update({ status: "processing", last_batch_at: new Date().toISOString() }).eq("id", id).eq("status", "paused");
  if (error) throw error;
}

export async function listBroadcasts(limit = 30) {
  const admin = supabaseAdmin();
  const { data, error } = await admin.from("official_broadcasts").select("*, official_flows(name)").order("created_at", { ascending: false }).limit(limit);
  if (error) throw error;
  return data || [];
}

export async function getBroadcast(id: string) {
  const admin = supabaseAdmin();
  const { data, error } = await admin.from("official_broadcasts").select("*, official_flows(name)").eq("id", id).maybeSingle();
  if (error) throw error;
  return data;
}

export async function listBroadcastRecipients(id: string, statusFilter?: string, limit = 500) {
  const admin = supabaseAdmin();
  let query = admin.from("official_broadcast_recipients").select("*").eq("broadcast_id", id).order("created_at", { ascending: true }).limit(limit);
  if (statusFilter && statusFilter !== "all") query = query.eq("status", statusFilter);
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

export async function listFailedRecipients(id: string) {
  const admin = supabaseAdmin();
  const { data, error } = await admin.from("official_broadcast_recipients").select("phone,row_data,error").eq("broadcast_id", id).eq("status", "failed");
  if (error) throw error;
  return data || [];
}
