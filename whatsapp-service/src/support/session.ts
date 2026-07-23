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
type GroupParticipantsHandler = (update: any, sock: any) => Promise<void>;

export async function createSupportSession(sessionId: string, onMessages: MessageHandler, onGroupParticipants?: GroupParticipantsHandler): Promise<SupportSession> {
  let auth = await useSupabaseAuthState(sessionId);
  let sock: any = null;
  let status: "connected" | "disconnected" | "connecting" = "connecting";
  let currentQr = "";
  let stopped = false;
  let starting = false;

  async function finishLogout() {
    if (!sock) return;
    await Promise.race([
      sock.logout().catch(() => undefined),
      new Promise((resolve) => setTimeout(resolve, 4_000))
    ]);
  }

  async function start(fresh = false) {
    if (stopped || starting) return;
    starting = true;
    try {
      if (fresh) {
        await auth.clearAuth();
        auth = await useSupabaseAuthState(sessionId);
      }
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
          if (!stopped) {
            if (code === DisconnectReason.loggedOut) setTimeout(() => start(true), 500);
            else setTimeout(() => start(), 5000);
          }
        }
      });

      sock.ev.on("messages.upsert", async ({ messages }: { messages: any[] }) => {
        try { await onMessages(messages); } catch (e) { console.error(`[support:${sessionId}] message error`, e); }
      });

      if (onGroupParticipants) {
        sock.ev.on("group-participants.update", async (update: any) => {
          try { await onGroupParticipants(update, sock); } catch (e) { console.error(`[support:${sessionId}] group update error`, e); }
        });
      }
    } finally {
      starting = false;
    }
  }

  await start();

  return {
    sessionId,
    get sock() { return sock; },
    getStatus: () => status,
    getQr: () => currentQr,
    logout: async () => {
      stopped = true;
      await finishLogout();
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
