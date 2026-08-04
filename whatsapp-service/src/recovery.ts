import { supabase } from "./supabase.js";
import { dbResult } from "./utils/db.js";
import { env } from "./env.js";
import { compatibleQueueUpdate, type DatabaseCapabilities, type QueueTable } from "./database-capabilities.js";

const restartUncertain = "Serviço reiniciou durante envio. Confirmação manual necessária para evitar duplicidade.";

async function recalcTouchedLotes(loteIds: Array<string | null | undefined>) {
  for (const loteId of new Set(loteIds.filter(Boolean) as string[])) {
    await dbResult("recovery.recalc-lote", supabase.rpc("recalc_lote_counts", { p_lote_id: loteId }));
  }
}

async function recoverTable(table: QueueTable, boot: boolean, capabilities: DatabaseCapabilities) {
  const now = new Date().toISOString();
  const group = table === "envios_grupo";
  const modern = capabilities[table].stabilityColumns;
  const fields = ["id", group ? "lote_id" : "", "status", modern ? "processing_deadline_at" : "claimed_at,started_at"].filter(Boolean).join(",");
  const active = await dbResult<any[]>(
    "recovery.list-active",
    supabase.from(table).select(fields).in("status", ["enfileirado", "processando"])
  );
  const expired = (item: any) => {
    if (boot) return true;
    if (modern) return !item.processing_deadline_at || item.processing_deadline_at < now;
    const startedAt = item.status === "processando" ? item.started_at : item.claimed_at;
    return !startedAt || new Date(startedAt).getTime() + env.QUEUE_PROCESSING_TIMEOUT_MS < Date.now();
  };
  const queuedIds = (active || []).filter((item) => item.status === "enfileirado" && expired(item)).map((item) => item.id);
  const processingIds = (active || []).filter((item) => item.status === "processando" && expired(item)).map((item) => item.id);

  if (queuedIds.length) {
    await dbResult("recovery.release-queued", supabase.from(table).update(compatibleQueueUpdate(capabilities, table, {
      status: "pendente",
      claim_token: null,
      processing_deadline_at: null,
      updated_at: now
    })).in("id", queuedIds));
  }
  if (processingIds.length) {
    await dbResult("recovery.mark-uncertain", supabase.from(table).update(compatibleQueueUpdate(capabilities, table, {
      status: "incerto",
      erro: restartUncertain,
      last_error_code: boot ? "SERVICE_RESTARTED" : "PROCESSING_DEADLINE_EXCEEDED",
      reconciliation_required: true,
      claim_token: null,
      processing_deadline_at: null,
      updated_at: now
    })).in("id", processingIds));
  }
  if (group) {
    await recalcTouchedLotes((active || []).filter((item) => queuedIds.includes(item.id) || processingIds.includes(item.id)).map((item) => item.lote_id));
  }
}

export async function recoverStuckJobsOnBoot(capabilities: DatabaseCapabilities) {
  await recoverTable("envios", true, capabilities);
  await recoverTable("envios_grupo", true, capabilities);
}

export async function periodicReclaim(capabilities: DatabaseCapabilities) {
  await recoverTable("envios", false, capabilities);
  await recoverTable("envios_grupo", false, capabilities);
}
