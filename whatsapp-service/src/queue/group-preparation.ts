import { jidEncode } from "@whiskeysockets/baileys";
import { withTimeout } from "../utils/timeout.js";

// Scoped to the socket: never share participants or Signal state across accounts
// or reconnects. The single-flight guard also avoids duplicate cold preparation.
export class GroupPreparation {
  private sockets = new WeakMap<object, Map<string, { expiresAt: number; work: Promise<any> }>>();

  cached(sock: object, jid: string) {
    const entry = this.sockets.get(sock)?.get(jid);
    return entry && entry.expiresAt > Date.now() ? entry.work : undefined;
  }

  invalidate(sock: object, jid: string) { this.sockets.get(sock)?.delete(jid); }

  prepare(sock: any, jid: string): Promise<any> {
    const cached = this.cached(sock, jid);
    if (cached) return cached;
    const entries = this.sockets.get(sock) || new Map();
    this.sockets.set(sock, entries);
    for (const [key, entry] of entries) if (entry.expiresAt <= Date.now()) entries.delete(key);
    const work = (async () => {
      const metadata = await sock.groupMetadata(jid);
      const devices = await sock.getUSyncDevices(metadata.participants.map((p: any) => p.id), true, false);
      // Establish recipient sessions before the deadline, without relaying a message.
      await sock.authState.keys.transaction(async () => {
        await sock.assertSessions(devices.map((d: any) => jidEncode(d.user, metadata.addressingMode === "lid" ? "lid" : "s.whatsapp.net", d.device)), false);
      });
      await sock.authState.keys.get("sender-key-memory", [jid]);
      return metadata;
    })();
    entries.set(jid, { expiresAt: Date.now() + 90_000, work });
    void work.catch(() => { if (entries.get(jid)?.work === work) entries.delete(jid); });
    return work;
  }
}

export const groupPreparation = new GroupPreparation();

// No message is relayed by preparation. Sending is a separate operation. Once relay times out, close that exact socket so its old
// promises cannot transmit later through an apparently free queue slot.
export async function sendWithDeadline<T>(sock: { end: (error: Error) => void }, timeoutMs: number, send: () => Promise<T>, signal?: AbortSignal) {
  signal?.throwIfAborted();
  const abort = () => sock.end(new Error("Envio excedeu o prazo; conexão encerrada para impedir envio tardio."));
  signal?.addEventListener("abort", abort, { once: true });
  try {
    return await withTimeout("whatsapp.sendMessage", timeoutMs, send, abort);
  } finally { signal?.removeEventListener("abort", abort); }
}
