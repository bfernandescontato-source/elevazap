import { env } from "./env.js";
import { periodicReclaim, recoverStuckJobsOnBoot } from "./recovery.js";
import { GlobalSendQueue } from "./queue/queue.js";
import { createHttpServer, type ServiceReadiness } from "./routes/http.js";
import { bootSenderSessions, renewOwnedSenderLeases, syncSenderSessionOwnership } from "./senders/runtime.js";
import { syncAllCampaignGroups } from "./groups/campaign-sync.js";
import { detectDatabaseCapabilities } from "./database-capabilities.js";
import { repairPendingGroupJobsWithoutSession } from "./queue/repair-pending-groups.js";
import { TemporaryMediaGarbageCollector } from "./queue/temporary-media-gc.js";
import { recoverInterruptedPilotOffers } from "./offers/offer-recovery.js";

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
    await bootSenderSessions().catch((error) => {
      readiness.lastError = error instanceof Error ? error.message : "Falha inicial ao assumir sessões.";
      console.error({ event: "sender.initial_sync_failed", error: readiness.lastError });
    });
    setInterval(async () => {
      try {
        await renewOwnedSenderLeases();
        await syncSenderSessionOwnership();
      } catch (error) {
        readiness.lastError = error instanceof Error ? error.message : "Falha no supervisor de sessões.";
        console.error({ event: "sender.supervisor_failed", error: readiness.lastError });
      }
    }, env.SESSION_SUPERVISOR_INTERVAL_MS);
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
