import { env } from "./env.js";
import { acquireLock, renewLock } from "./lock.js";
import { periodicReclaim, recoverStuckJobsOnBoot } from "./recovery.js";
import { GlobalSendQueue } from "./queue/queue.js";
import { createHttpServer } from "./routes/http.js";
import { createWhatsAppRuntime } from "./whatsapp.js";
import { bootSupportRuntime } from "./support/runtime.js";

async function main() {
  const lock = await acquireLock();
  if (!lock) {
    console.error("Outra instância do whatsapp-service está ativa. Encerrando.");
    process.exit(1);
  }
  setInterval(async () => {
    const ok = await renewLock().catch(() => false);
    if (!ok) process.exit(1);
  }, 15_000);

  await recoverStuckJobsOnBoot();
  setInterval(periodicReclaim, 60_000);

  const runtime = await createWhatsAppRuntime();
  await runtime.start();
  const queue = new GlobalSendQueue(runtime);
  queue.start();

  // Boot support agent sessions (doesn't block the main queue)
  bootSupportRuntime().catch((e) => console.error("[support] boot error:", e));

  const app = createHttpServer(runtime, queue);
  app.listen(env.PORT, () => console.log(`whatsapp-service listening on ${env.PORT}`));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
