import makeWASocket, { DisconnectReason } from "@whiskeysockets/baileys";
import { pino } from "pino";
import qrcode from "qrcode";
import { Boom } from "@hapi/boom";
import { useSupabaseAuthState } from "../auth/supabase-auth-state.js";
import { env } from "../env.js";
import { withTimeout } from "../utils/timeout.js";
import { errorFields } from "../utils/log.js";
import { getBaileysVersion } from "../utils/baileys-version.js";

export type SupportSession = {
  sessionId: string;
  sock: any;
  getStatus: () => "idle" | "starting" | "waiting_qr" | "connected" | "reconnecting" | "logged_out" | "failed";
  getQr: () => string;
  getLastError: () => string | null;
  logout: () => Promise<void>;
  stop: () => void;
};

type MessageHandler = (messages: any[]) => Promise<void>;
type GroupParticipantsHandler = (update: any, sock: any) => Promise<void>;

export async function createSupportSession(sessionId: string, onMessages: MessageHandler, onGroupParticipants?: GroupParticipantsHandler, accountId?: string): Promise<SupportSession> {
  let auth = await useSupabaseAuthState(sessionId, accountId);
  let sock: any = null;
  let status: ReturnType<SupportSession["getStatus"]> = "idle";
  let currentQr = "";
  let stopped = false;
  let starting = false;
  let lastError: string | null = null;

  async function finishLogout() {
    if (!sock) return;
    const current = sock;
    await withTimeout("whatsapp.stop", env.WHATSAPP_STOP_TIMEOUT_MS, current.logout(), () => current.end(undefined)).catch(() => undefined);
    current.end(undefined);
    sock = null;
  }

  async function start(fresh = false) {
    if (stopped || starting) return;
    starting = true;
    status = "starting";
    currentQr = "";
    lastError = null;
    try {
      if (fresh) {
        await auth.clearAuth();
        auth = await useSupabaseAuthState(sessionId, accountId);
      }
      const version = await withTimeout("whatsapp.version", env.WHATSAPP_START_TIMEOUT_MS, getBaileysVersion());
      sock = makeWASocket({
        version,
        auth: auth.state,
        printQRInTerminal: false,
        logger: pino({ level: "silent" })
      });

      sock.ev.on("creds.update", () => auth.saveCreds().catch((error) => {
        status = "failed";
        lastError = "Falha ao salvar a conexão do WhatsApp.";
        console.error({ event: "whatsapp.credentials_save_failed", component: "managed-session", ...errorFields(error) });
      }));

      sock.ev.on("connection.update", async (update: any) => {
        if (update.qr) { currentQr = await qrcode.toDataURL(update.qr); status = "waiting_qr"; }
        if (update.connection === "open") { status = "connected"; currentQr = ""; lastError = null; }
        if (update.connection === "connecting" && status !== "waiting_qr") status = "starting";
        if (update.connection === "close") {
          const code = (update.lastDisconnect?.error as Boom | undefined)?.output?.statusCode;
          if (!stopped) {
            if (code === DisconnectReason.loggedOut) {
              status = "logged_out";
              currentQr = "";
              lastError = "A sessão foi desconectada pelo WhatsApp.";
            } else {
              status = "reconnecting";
              lastError = "Conexão interrompida. Tentando novamente.";
              setTimeout(() => void start().catch(() => undefined), 5000);
            }
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
    } catch (error) {
      status = "failed";
      lastError = error instanceof Error ? error.message : "Falha ao iniciar o WhatsApp.";
      console.error({ event: "whatsapp.start_failed", component: "managed-session", ...errorFields(error) });
      throw error;
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
    getLastError: () => lastError,
    logout: async () => {
      stopped = true;
      await finishLogout();
      await auth.clearAuth();
      status = "logged_out";
      currentQr = "";
      lastError = null;
    },
    stop: () => {
      stopped = true;
      sock?.end(undefined);
      status = "idle";
    }
  };
}
