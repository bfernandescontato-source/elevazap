import { supabase } from "./supabase.js";
import { dbResult } from "./utils/db.js";

const restartUncertain = "Serviço reiniciou durante envio. Confirmação manual necessária para evitar duplicidade.";

async function recalcTouchedLotes(loteIds: Array<string | null | undefined>) {
  for (const loteId of new Set(loteIds.filter(Boolean) as string[])) {
    await dbResult("recovery.recalc-lote", supabase.rpc("recalc_lote_counts", { p_lote_id: loteId }));
  }
}

async function recoverTable(table: "envios" | "envios_grupo", boot: boolean) {
  const now = new Date().toISOString();
  const group = table === "envios_grupo";
  const fields = group ? "id,lote_id,status,processing_deadline_at" : "id,status,processing_deadline_at";
  const active = await dbResult<any[]>(
    "recovery.list-active",
    supabase.from(table).select(fields).in("status", ["enfileirado", "processando"])
  );
  const queuedIds = (active || []).filter((item) => item.status === "enfileirado" && (boot || !item.processing_deadline_at || item.processing_deadline_at < now)).map((item) => item.id);
  const processingIds = (active || []).filter((item) => item.status === "processando" && (boot || !item.processing_deadline_at || item.processing_deadline_at < now)).map((item) => item.id);

  if (queuedIds.length) {
    await dbResult("recovery.release-queued", supabase.from(table).update({
      status: "pendente",
      claim_token: null,
      processing_deadline_at: null,
      updated_at: now
    }).in("id", queuedIds));
  }
  if (processingIds.length) {
    await dbResult("recovery.mark-uncertain", supabase.from(table).update({
      status: "incerto",
      erro: restartUncertain,
      last_error_code: boot ? "SERVICE_RESTARTED" : "PROCESSING_DEADLINE_EXCEEDED",
      reconciliation_required: true,
      claim_token: null,
      processing_deadline_at: null,
      updated_at: now
    }).in("id", processingIds));
  }
  if (group) {
    await recalcTouchedLotes((active || []).filter((item) => queuedIds.includes(item.id) || processingIds.includes(item.id)).map((item) => item.lote_id));
  }
}

export async function recoverStuckJobsOnBoot() {
  await recoverTable("envios", true);
  await recoverTable("envios_grupo", true);
}

export async function periodicReclaim() {
  await recoverTable("envios", false);
  await recoverTable("envios_grupo", false);
}
