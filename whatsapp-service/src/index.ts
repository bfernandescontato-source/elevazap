import { env } from "./env.js";
import { periodicReclaim, recoverStuckJobsOnBoot } from "./recovery.js";
import { GlobalSendQueue } from "./queue/queue.js";
import { createHttpServer, type ServiceReadiness } from "./routes/http.js";
import { bootSenderSessions, renewOwnedSenderLeases, syncSenderSessionOwnership } from "./senders/runtime.js";
import { syncAllCampaignGroups } from "./groups/campaign-sync.js";
import { detectDatabaseCapabilities } from "./database-capabilities.js";
import { repairPendingGroupJobsWithoutSession } from "./queue/repair-pending-groups.js";

async function main() {
  const queueRef: { current: GlobalSendQueue | null } = { current: null };
  const readiness: ServiceReadiness = { processStarted: true, supabase: false, queue: false, lastError: null };
  const app = createHttpServer(queueRef, readiness);
  app.listen(env.PORT, () => console.log(`whatsapp-service listening on ${env.PORT}`));

  try {
    readiness.supabase = true;

    const databaseCapabilities = await detectDatabaseCapabilities();
    await recoverStuckJobsOnBoot(databaseCapabilities);
    await repairPendingGroupJobsWithoutSession();
    const queue = new GlobalSendQueue(databaseCapabilities);
    queueRef.current = queue;
    queue.start();
    readiness.queue = true;

    setInterval(() => repairPendingGroupJobsWithoutSession().catch((error) => {
      console.error("[queue] pending group session repair failed", error);
    }), 30_000);

    setInterval(() => periodicReclaim(databaseCapabilities).catch((error) => {
      readiness.lastError = error instanceof Error ? error.message : "Falha na recuperação da fila.";
    }), 60_000);

    await bootSenderSessions();
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
