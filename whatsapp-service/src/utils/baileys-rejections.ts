import { appendFileSync } from "node:fs";
import { inspect } from "node:util";

/**
 * Container logs keep only ~45 min (half of it libsignal noise), so the error
 * behind a crash is usually gone by the time anyone looks. The container's
 * filesystem survives restarts (not redeploys), so fatal errors are also
 * appended here: `docker exec disparei-whatsapp cat /tmp/disparei-crash.log`.
 */
export const CRASH_LOG_PATH = "/tmp/disparei-crash.log";

/**
 * Baileys fires some socket writes (e.g. message retry receipts) without
 * awaiting them. When that session's socket has just closed, the write
 * rejects with a Boom "Connection Closed" (428) that nobody catches, and
 * Node's default policy kills the whole service — dropping every number,
 * which then reconnects at once and triggers more of the same. That specific
 * rejection only concerns the one closed socket (it reconnects on its own),
 * so it is logged instead of crashing. Anything else still crashes as before.
 */
export function isClosedSocketRejection(reason: unknown): boolean {
  const boom = reason as { isBoom?: boolean; output?: { statusCode?: number }; message?: string } | null;
  return Boolean(boom?.isBoom && boom.output?.statusCode === 428 && boom.message === "Connection Closed");
}

export function installBaileysRejectionGuard() {
  process.on("uncaughtExceptionMonitor", (error, origin) => {
    try {
      appendFileSync(CRASH_LOG_PATH, `${new Date().toISOString()} ${origin}\n${inspect(error, { depth: 4 })}\n\n`);
    } catch {
      // never let crash logging hide the original crash
    }
  });
  process.on("unhandledRejection", (reason) => {
    if (isClosedSocketRejection(reason)) {
      console.warn({ event: "whatsapp.closed_socket_rejection_ignored", component: "runtime" });
      return;
    }
    throw reason;
  });
}
