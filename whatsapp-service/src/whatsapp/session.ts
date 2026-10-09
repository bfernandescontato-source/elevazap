import makeWASocket, { DisconnectReason, proto } from "@whiskeysockets/baileys";
import { randomUUID } from "crypto";
import { pino } from "pino";
import qrcode from "qrcode";
import { Boom } from "@hapi/boom";
import { useSupabaseAuthState } from "../auth/supabase-auth-state.js";
import { env } from "../env.js";
import { withTimeout } from "../utils/timeout.js";
import { errorFields } from "../utils/log.js";
import { getBaileysVersion } from "../utils/baileys-version.js";
import { observer } from "../observability/observer.js";
import { createInstanceHooks } from "../observability/socket-hooks.js";
import { guardNoiseDecrypt } from "../utils/noise-guard.js";
import { guardOfflineBuffer } from "../utils/offline-buffer-guard.js";
import { createSentMessageStore } from "./sent-message-store.js";

export type WhatsAppSession = {
  sessionId: string;
  instanceId: string;
  sock: any;
  getStatus: () => "idle" | "starting" | "waiting_qr" | "connected" | "reconnecting" | "logged_out" | "failed";
  getQr: () => string;
  getLastError: () => string | null;
  logout: () => Promise<void>;
  stop: () => Promise<void>;
};

const CREDS_SAVE_ERROR = "Falha ao salvar a conexão do WhatsApp.";
const CREDS_SAVE_ATTEMPTS = 3;
const CREDS_SAVE_RETRY_MS = 3_000;
const CIPHERTEXT_STUB = proto.WebMessageInfo.StubType.CIPHERTEXT;

// Observabilidade nunca pode derrubar o fluxo do WhatsApp.
function observe(action: () => void) {
  try { action(); } catch (error) { console.error({ event: "obs.observe_failed", error: String((error as Error)?.message || error) }); }
}

type MessageHandler = (messages: any[], upsertType?: string) => Promise<void>;
type GroupParticipantsHandler = (update: any, sock: any) => Promise<void>;
type StatusHandler = (status: ReturnType<WhatsAppSession["getStatus"]>, error: string | null) => Promise<void>;

export async function createWhatsAppSession(sessionId: string, onMessages: MessageHandler, onGroupParticipants?: GroupParticipantsHandler, accountId?: string, onStatus?: StatusHandler): Promise<WhatsAppSession> {
  let auth = await useSupabaseAuthState(sessionId, accountId);
  let sock: any = null;
  let status: ReturnType<WhatsAppSession["getStatus"]> = "idle";
  let currentQr = "";
  let stopped = false;
  let starting = false;
  let lastError: string | null = null;

  let socketOpen = false;
  // Identidade desta instância e de cada socket que ela cria: duas instâncias
  // vivas para o mesmo número (sessão órfã) aparecem como dois ids diferentes.
  const instanceId = randomUUID();
  let socketSeq = 0;
  // Mensagens enviadas por este número: atende o pedido de reenvio do WhatsApp (getMessage).
  const sentMessages = createSentMessageStore();
  // Ouvintes de observação: só registrados enquanto a observação estiver
  // ligada para este número (ver observability/socket-hooks.ts).
  const hooks = createInstanceHooks(sessionId, instanceId, accountId, () => ({
    status,
    stopped,
    starting,
    socket_seq: socketSeq,
    socket_open: socketOpen,
    ws_open: Boolean(sock?.ws?.isOpen),
    is_buffering: typeof sock?.ev?.isBuffering === "function" ? sock.ev.isBuffering() : null,
    listeners: {
      ws_frame: sock?.ws?.listenerCount?.("frame") ?? null,
      ws_message: sock?.ws?.listenerCount?.("message") ?? null,
      cb_message: sock?.ws?.listenerCount?.("CB:message") ?? null
    },
    last_error: lastError
  }));

  const reportStatus = () => onStatus?.(status, lastError).catch((error) =>
    console.error({ event: "whatsapp.status_persist_failed", component: "managed-session", ...errorFields(error) })
  );

  /**
   * A slow database used to turn one failed credentials write into a
   * permanent "failed" status: the socket kept working (offers were still
   * captured) but the queue stopped sending through the number until someone
   * restarted it. The write is retried, and a later successful write brings a
   * still-open socket back to "connected".
   */
  async function saveCredsWithRetry() {
    for (let attempt = 1; attempt <= CREDS_SAVE_ATTEMPTS; attempt++) {
      try {
        await auth.saveCreds();
        if (status === "failed" && lastError === CREDS_SAVE_ERROR && socketOpen && !stopped) {
          status = "connected";
          lastError = null;
          void reportStatus();
        }
        return;
      } catch (error) {
        console.error({ event: "whatsapp.credentials_save_failed", component: "managed-session", attempt, ...errorFields(error) });
        observe(() => observer.count(sessionId, "creds_save_fail"));
        if (attempt === CREDS_SAVE_ATTEMPTS) {
          status = "failed";
          lastError = CREDS_SAVE_ERROR;
          void reportStatus();
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, CREDS_SAVE_RETRY_MS * attempt));
      }
    }
  }

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
    void reportStatus();
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
        logger: pino({ level: "silent" }),
        // Baileys não cria preview no cliente: ele precisa montar os metadados
        // antes do envio. Com isso, links de ofertas recebem thumbnail em alta
        // qualidade quando a URL disponibiliza Open Graph acessível.
        generateHighQualityLinkPreview: true,
        // Reenvio pedido pelo WhatsApp: só com a mensagem original deste número.
        // Sem ela, a correção do Baileys (scripts/patch-baileys-retry.mjs) não cria sessão nova.
        getMessage: async (key: any) => sentMessages.get(key) as any
      });
      const seq = ++socketSeq;
      const created = sock;
      // Falha do Noise fecha só este socket em vez de derrubar o processo.
      guardNoiseDecrypt(created, (error) => {
        console.warn({ event: "whatsapp.noise_decrypt_failed", component: "managed-session", session_name: sessionId, session_instance_id: instanceId, socket_seq: seq, message: error.message });
        observe(() => observer.count(sessionId, "noise_decrypt_failed"));
      });
      observe(() => hooks.socketCreated(created, seq));
      let stopOfflineGuard: (() => void) | null = null;

      sock.ev.on("creds.update", () => {
        observe(() => { observer.count(sessionId, "creds_update"); observer.mark(sessionId, "creds_update"); });
        void saveCredsWithRetry();
      });

      sock.ev.on("connection.update", async (update: any) => {
        if (update.qr) observe(() => observer.count(sessionId, "qr"));
        if (update.connection === "open") observe(() => observer.socketOpened(sessionId, instanceId, seq));
        if (update.qr) { currentQr = await qrcode.toDataURL(update.qr); status = "waiting_qr"; void reportStatus(); }
        if (update.connection === "open") { socketOpen = true; status = "connected"; currentQr = ""; lastError = null; void reportStatus(); }
        if (update.connection === "open" && !stopOfflineGuard) {
          stopOfflineGuard = guardOfflineBuffer(created, (event, fields) =>
            console.warn({ event, component: "managed-session", session_name: sessionId, session_instance_id: instanceId, socket_seq: seq, ...fields }));
        }
        if (update.connection === "connecting" && status !== "waiting_qr") { status = "starting"; void reportStatus(); }
        if (update.connection === "close") {
          socketOpen = false;
          stopOfflineGuard?.();
          const code = (update.lastDisconnect?.error as Boom | undefined)?.output?.statusCode;
          observe(() => observer.socketClosed(sessionId, instanceId, seq, code ?? null, stopped));
          // Sem este registro não dá para saber por que um número "conecta e desconecta".
          console.warn({ event: "whatsapp.connection_closed", component: "managed-session", session_name: sessionId, session_instance_id: instanceId, socket_seq: seq, code: code ?? null, message: String(update.lastDisconnect?.error?.message || "").slice(0, 200), stopped });
          if (!stopped) {
            // 401/403/419 = WhatsApp recusou/baniu a sessão (UNAUTHORIZED_CODES do Baileys).
            // Reconectar nesses casos é inútil e só martela o serviço (um número banido
            // chegou a 348 reconexões em 2h, derrubando a entrega dos outros números).
            if (code === DisconnectReason.loggedOut || code === 403 || code === 419) {
              status = "logged_out";
              currentQr = "";
              lastError = code === DisconnectReason.loggedOut
                ? "A sessão foi desconectada pelo WhatsApp."
                : "O WhatsApp bloqueou este número. Reconecte lendo um novo QR (ou use outro número).";
              void reportStatus();
            } else {
              status = "reconnecting";
              lastError = "Conexão interrompida. Tentando novamente.";
              void reportStatus();
              setTimeout(() => void start().catch(() => undefined), 5000);
            }
          }
        }
      });

      sock.ev.on("messages.upsert", async ({ messages, type }: { messages: any[]; type?: string }) => {
        observe(() => observer.upsert(sessionId, type, messages, CIPHERTEXT_STUB, instanceId, seq));
        try { sentMessages.remember(messages); } catch { /* a loja de reenvio nunca atrapalha o recebimento */ }
        try { await onMessages(messages, type); } catch (error) { console.error(`[whatsapp:${sessionId}] message error`, error); }
      });
      if (onGroupParticipants) {
        sock.ev.on("group-participants.update", async (update: any) => {
          try { await onGroupParticipants(update, sock); } catch (error) { console.error(`[whatsapp:${sessionId}] group update error`, error); }
        });
      }
    } catch (error) {
      status = "failed";
      lastError = error instanceof Error ? error.message : "Falha ao iniciar o WhatsApp.";
      void reportStatus();
      console.error({ event: "whatsapp.start_failed", component: "managed-session", ...errorFields(error) });
      throw error;
    } finally {
      starting = false;
    }
  }

  try {
    await start();
  } catch (error) {
    observe(() => hooks.release("start_failed"));
    throw error;
  }
  return {
    sessionId,
    instanceId,
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
      void reportStatus();
      observe(() => hooks.release("logout"));
    },
    stop: async () => {
      stopped = true;
      sock?.end(undefined);
      sock = null;
      await auth.waitForIdle();
      status = "idle";
      void reportStatus();
      observe(() => hooks.release("stop"));
    }
  };
}
