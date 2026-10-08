import { env } from "./env.js";
import { periodicReclaim, recoverStuckJobsOnBoot } from "./recovery.js";
import { GlobalSendQueue } from "./queue/queue.js";
import { createHttpServer, type ServiceReadiness } from "./routes/http.js";
import { bootSenderSessions, renewOwnedSenderLeases, restartDeafPilotSenders, syncSenderSessionOwnership } from "./senders/runtime.js";
import { syncAllCampaignGroups } from "./groups/campaign-sync.js";
import { detectDatabaseCapabilities } from "./database-capabilities.js";
import { repairPendingGroupJobsWithoutSession } from "./queue/repair-pending-groups.js";
import { TemporaryMediaGarbageCollector } from "./queue/temporary-media-gc.js";
import { recoverInterruptedPilotOffers } from "./offers/offer-recovery.js";
import { installBaileysRejectionGuard } from "./utils/baileys-rejections.js";
import { installLibsignalLogFilter } from "./utils/libsignal-log-filter.js";
import { startObservability } from "./observability/bootstrap.js";
import { SupervisorCycle } from "./observability/supervisor-trace.js";
import { observer } from "./observability/observer.js";

installLibsignalLogFilter();
installBaileysRejectionGuard();
startObservability();

async function prepareDatabaseRuntime(readiness: ServiceReadiness) {
  let attempt = 0;
  for (;;) {
    try {
      const databaseCapabilities = await detectDatabaseCapabilities();
      await recoverStuckJobsOnBoot(databaseCapabilities);
      await repairPendingGroupJobsWithoutSession();
      readiness.supabase = true;
      readiness.lastError = null;
      return databaseCapabilities;
    } catch (error) {
      attempt += 1;
      readiness.supabase = false;
      readiness.lastError = error instanceof Error ? error.message : "Falha ao conectar ao banco.";
      const retryInMs = Math.min(30_000, 2_000 * attempt);
      console.error({
        event: "service.database_initialization_retry",
        attempt,
        retry_in_ms: retryInMs,
        error: readiness.lastError
      });
      await new Promise((resolve) => setTimeout(resolve, retryInMs));
    }
  }
}

async function main() {
  const queueRef: { current: GlobalSendQueue | null } = { current: null };
  const readiness: ServiceReadiness = { processStarted: true, supabase: false, queue: false, lastError: null };
  const app = createHttpServer(queueRef, readiness);
  app.listen(env.PORT, () => console.log(`whatsapp-service listening on ${env.PORT}`));

  try {
    const databaseCapabilities = await prepareDatabaseRuntime(readiness);
    const queue = new GlobalSendQueue(databaseCapabilities);
    const mediaGc = new TemporaryMediaGarbageCollector();
    queueRef.current = queue;
    queue.start();
    readiness.queue = true;

    // Affiliate conversion may be slow or temporarily unavailable. Recovery
    // must never hold the dispatcher and WhatsApp sessions behind it on boot.
    void recoverInterruptedPilotOffers().catch((error) => {
      console.error({ event: "offer_recovery_initial_failed", component: "offer-autopilot", error: error instanceof Error ? error.message : "unknown" });
    });

    setInterval(() => repairPendingGroupJobsWithoutSession().catch((error) => {
      console.error("[queue] pending group session repair failed", error);
    }), 30_000);

    setInterval(() => periodicReclaim(databaseCapabilities).catch((error) => {
      readiness.lastError = error instanceof Error ? error.message : "Falha na recuperação da fila.";
    }), 60_000);
    setInterval(() => recoverInterruptedPilotOffers().catch((error) => {
      console.error({ event: "offer_recovery_loop_failed", component: "offer-autopilot", error: error instanceof Error ? error.message : "unknown" });
    }), 60_000);
    if (env.TEMPORARY_MEDIA_GC_ENABLED) {
      setInterval(() => mediaGc.runIfDue().catch((error) => {
        console.error({ event: "temporary_media_gc_failed", component: "media-gc", error: error instanceof Error ? error.message : "unknown" });
      }), 60_000);
      setTimeout(() => mediaGc.runIfDue().catch((error) => {
        console.error({ event: "temporary_media_gc_initial_failed", component: "media-gc", error: error instanceof Error ? error.message : "unknown" });
      }), 30_000);
    } else {
      console.info({ event: "temporary_media_gc_disabled", component: "media-gc", reason: "awaiting_first_audited_inventory" });
    }

    // A transient session/lease error must not prevent the dispatcher and the
    // supervisor from recovering on the next pass.
    // Só mede quanto o boot das sessões demora (as posses valem
    // SESSION_LEASE_TTL_SECONDS desde a aquisição no início do boot).
    const bootCycle = observer.isEnabled() ? new SupervisorCycle("boot") : undefined;
    let bootError: unknown = null;
    await bootSenderSessions(bootCycle).catch((error) => {
      bootError = error;
      readiness.lastError = error instanceof Error ? error.message : "Falha inicial ao assumir sessões.";
      console.error({ event: "sender.initial_sync_failed", error: readiness.lastError });
    });
    try { bootCycle?.end(bootError); } catch { /* observabilidade */ }
    let senderSupervisorRunning = false;
    setInterval(async () => {
      if (senderSupervisorRunning) {
        console.warn({ event: "sender.supervisor_skipped", reason: "previous_cycle_still_running" });
        return;
      }
      senderSupervisorRunning = true;
      // Só mede o ciclo (duração, sobreposição, operação lenta, event loop);
      // a ordem e a concorrência continuam as mesmas.
      const cycle = observer.isEnabled() ? new SupervisorCycle() : undefined;
      let cycleError: unknown = null;
      try {
        await renewOwnedSenderLeases(cycle);
        await syncSenderSessionOwnership(cycle);
      } catch (error) {
        cycleError = error;
        readiness.lastError = error instanceof Error ? error.message : "Falha no supervisor de sessões.";
        console.error({ event: "sender.supervisor_failed", error: readiness.lastError });
      } finally {
        try { cycle?.end(cycleError); } catch { /* observabilidade */ }
        senderSupervisorRunning = false;
      }
    }, env.SESSION_SUPERVISOR_INTERVAL_MS);
    // Watchdog de número surdo DESLIGADO (07/10): o reinício automático não cura
    // número surdo de verdade (precisa QR) e só gera reconexão à toa, que o
    // WhatsApp penaliza. Número que cai de verdade reconecta sozinho (handler de
    // connection close); surdo mesmo é recuperado por QR.
    // setInterval(() => restartDeafPilotSenders().catch((error) => console.error({ event: "sender_deaf_watch_failed", error: error instanceof Error ? error.message : String(error) })), 5 * 60_000);
    void restartDeafPilotSenders;
    setTimeout(() => syncAllCampaignGroups().catch((error) => console.error("[groups] initial sync error:", error)), 15_000);
    setInterval(() => syncAllCampaignGroups().catch((error) => console.error("[groups] periodic sync error:", error)), 5 * 60_000);
  } catch (error) {
    readiness.lastError = error instanceof Error ? error.message : "Falha na inicialização interna.";
    console.error({ event: "service.initialization_failed", error: readiness.lastError });
  }
}

main().catch((error) => {
  console.error(error);
});
