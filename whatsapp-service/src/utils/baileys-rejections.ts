import { appendFileSync } from "node:fs";
import { inspect } from "node:util";
import { handleNoiseDecryptRejection } from "./noise-guard.js";

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

/**
 * Same family, seen twice on 2026-09-28 (22:11 and 22:13 UTC): Baileys'
 * `uploadPreKeysToServerIfRequired` runs un-awaited on connection open and its
 * `query()` times out with a Boom "Timed Out" (408) when WhatsApp is slow to
 * answer. Only that one request failed — the socket keeps its own keep-alive
 * and reconnects if it is really dead — but the stray rejection killed the
 * service and dropped every number. Logged instead of crashing.
 */
export function isTimedOutQueryRejection(reason: unknown): boolean {
  const boom = reason as { isBoom?: boolean; output?: { statusCode?: number }; message?: string } | null;
  return Boolean(boom?.isBoom && boom.output?.statusCode === 408 && boom.message === "Timed Out");
}

/**
 * Same family again (2026-10-05, 4 crashes in 20 min): Baileys' waitForMessage
 * listens to the socket "close" event as its error callback, so when the socket
 * closes mid-query (e.g. "Stream Errored (conflict)") the query rejects with the
 * raw WebSocket close code (1006) instead of the Boom "Connection Closed" it
 * uses when no code is given. Same meaning, same handling.
 */
export function isWebSocketCloseCodeRejection(reason: unknown): boolean {
  return typeof reason === "number" && Number.isInteger(reason) && reason >= 1000 && reason <= 4999;
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
    if (isWebSocketCloseCodeRejection(reason)) {
      console.warn({ event: "whatsapp.socket_close_code_rejection_ignored", component: "runtime", code: reason });
      return;
    }
    if (isTimedOutQueryRejection(reason)) {
      console.warn({ event: "whatsapp.timed_out_query_rejection_ignored", component: "runtime" });
      return;
    }
    // Falha do Noise (07/10: 4 quedas): fecha só o socket afetado.
    if (handleNoiseDecryptRejection(reason)) return;
    throw reason;
  });
}
