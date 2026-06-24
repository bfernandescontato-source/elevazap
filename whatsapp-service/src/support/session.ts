import makeWASocket, { DisconnectReason, fetchLatestBaileysVersion } from "@whiskeysockets/baileys";
import { pino } from "pino";
import qrcode from "qrcode";
import { Boom } from "@hapi/boom";
import { useSupabaseAuthState } from "../auth/supabase-auth-state.js";

export type SupportSession = {
  sessionId: string;
  sock: any;
  getStatus: () => "connected" | "disconnected" | "connecting";
  getQr: () => string;
  logout: () => Promise<void>;
  stop: () => void;
};

type MessageHandler = (messages: any[]) => Promise<void>;

export async function createSupportSession(sessionId: string, onMessages: MessageHandler): Promise<SupportSession> {
  const auth = await useSupabaseAuthState(sessionId);
  let sock: any = null;
  let status: "connected" | "disconnected" | "connecting" = "connecting";
  let currentQr = "";
  let stopped = false;

  async function start() {
    if (stopped) return;
    const { version } = await fetchLatestBaileysVersion();
    sock = makeWASocket({
      version,
      auth: auth.state,
      printQRInTerminal: false,
      logger: pino({ level: "silent" })
    });

    sock.ev.on("creds.update", auth.saveCreds);

    sock.ev.on("connection.update", async (update: any) => {
      if (update.qr) currentQr = await qrcode.toDataURL(update.qr);
      if (update.connection === "open") { status = "connected"; currentQr = ""; }
      if (update.connection === "connecting") status = "connecting";
      if (update.connection === "close") {
        status = "disconnected";
        const code = (update.lastDisconnect?.error as Boom | undefined)?.output?.statusCode;
        if (!stopped && code !== DisconnectReason.loggedOut) setTimeout(start, 5000);
      }
    });

    sock.ev.on("messages.upsert", async ({ messages }: { messages: any[] }) => {
      try { await onMessages(messages); } catch (e) { console.error(`[support:${sessionId}] message error`, e); }
    });
  }

  await start();

  return {
    sessionId,
    get sock() { return sock; },
    getStatus: () => status,
    getQr: () => currentQr,
    logout: async () => {
      stopped = true;
      await sock?.logout().catch(() => undefined);
      await auth.clearAuth();
      status = "disconnected";
      currentQr = "";
    },
    stop: () => {
      stopped = true;
      sock?.end(undefined);
      status = "disconnected";
    }
  };
}
