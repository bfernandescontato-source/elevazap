import { env } from "./env.js";
import { acquireLock, renewLock } from "./lock.js";
import { periodicReclaim, recoverStuckJobsOnBoot } from "./recovery.js";
import { GlobalSendQueue } from "./queue/queue.js";
import { createHttpServer, type ServiceReadiness } from "./routes/http.js";
import { bootSupportRuntime } from "./support/runtime.js";
import { bootSenderSessions } from "./senders/runtime.js";
import { syncAllCampaignGroups } from "./groups/campaign-sync.js";
import { detectDatabaseCapabilities } from "./database-capabilities.js";

async function main() {
  const queueRef: { current: GlobalSendQueue | null } = { current: null };
  const readiness: ServiceReadiness = { processStarted: true, supabase: false, queue: false, lastError: null };
  const app = createHttpServer(queueRef, readiness);
  app.listen(env.PORT, () => console.log(`whatsapp-service listening on ${env.PORT}`));

  try {
    const lock = await acquireLock();
    readiness.supabase = true;
    if (!lock) throw new Error("Outra instância do whatsapp-service está ativa.");

    const databaseCapabilities = await detectDatabaseCapabilities();
    await recoverStuckJobsOnBoot(databaseCapabilities);
    const queue = new GlobalSendQueue(databaseCapabilities);
    queueRef.current = queue;
    queue.start();
    readiness.queue = true;

    setInterval(async () => {
      const ok = await renewLock().catch(() => false);
      if (!ok) {
        readiness.queue = false;
        readiness.supabase = false;
        readiness.lastError = "O serviço perdeu o lock exclusivo da fila.";
        queue.stop();
      }
    }, 15_000);
    setInterval(() => periodicReclaim(databaseCapabilities).catch((error) => {
      readiness.lastError = error instanceof Error ? error.message : "Falha na recuperação da fila.";
    }), 60_000);

    bootSupportRuntime().catch((error) => console.error("[support] boot error:", error));
    bootSenderSessions().catch((error) => console.error("[sender] boot error:", error));
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
