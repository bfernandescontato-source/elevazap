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
  process.on("unhandledRejection", (reason) => {
    if (isClosedSocketRejection(reason)) {
      console.warn({ event: "whatsapp.closed_socket_rejection_ignored", component: "runtime" });
      return;
    }
    throw reason;
  });
}
