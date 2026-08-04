import makeWASocket, { DisconnectReason } from "@whiskeysockets/baileys";
import { pino } from "pino";
import qrcode from "qrcode";
import { Boom } from "@hapi/boom";
import { supabase } from "./supabase.js";
import { useSupabaseAuthState } from "./auth/supabase-auth-state.js";
import { discoverGroupByInvite, discoverParticipatingGroups, groupToStoredRow } from "./groups/discovery.js";
import { syncGroupMetadata } from "./groups/sync.js";
import { scheduleParticipantEventSync } from "./groups/events.js";
import { env } from "./env.js";
import { withTimeout } from "./utils/timeout.js";
import { errorFields } from "./utils/log.js";
import { getBaileysVersion } from "./utils/baileys-version.js";

export type WhatsAppRuntime = Awaited<ReturnType<typeof createWhatsAppRuntime>>;
export type WhatsAppState = "idle" | "starting" | "waiting_qr" | "connected" | "reconnecting" | "logged_out" | "failed";

export async function createWhatsAppRuntime() {
  let auth = await useSupabaseAuthState();
  let sock: any = null;
  let status: WhatsAppState = "idle";
  let currentQr = "";
  let starting = false;
  let generation = 0;
  let reconnectTimer: NodeJS.Timeout | undefined;
  let lastError: string | null = null;

  async function stopSocket(logout = false) {
    if (!sock) return;
    const current = sock;
    sock = null;
    await withTimeout("whatsapp.stop", env.WHATSAPP_STOP_TIMEOUT_MS, async () => {
      if (logout) await current.logout();
      current.end(undefined);
    }, () => current.end(undefined)).catch((error) => {
      console.error({ event: "whatsapp.stop_failed", component: "main-session", ...errorFields(error) });
    });
  }

  async function start(fresh = false) {
    if (starting) return;
    starting = true;
    status = "starting";
    currentQr = "";
    lastError = null;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    const currentGeneration = ++generation;
    try {
      if (fresh) {
        await auth.clearAuth();
        auth = await useSupabaseAuthState();
      }
      const version = await withTimeout("whatsapp.version", env.WHATSAPP_START_TIMEOUT_MS, getBaileysVersion());
      await stopSocket(false);
      const nextSock = makeWASocket({
        version,
        auth: auth.state,
        printQRInTerminal: false,
        logger: pino({ level: "warn" })
      });
      sock = nextSock;

      nextSock.ev.on("creds.update", () => auth.saveCreds().catch((error) => {
        lastError = "Falha ao persistir credenciais do WhatsApp.";
        console.error({ event: "whatsapp.credentials_save_failed", component: "main-session", ...errorFields(error) });
      }));
      nextSock.ev.on("group-participants.update", (update: any) => scheduleParticipantEventSync(null, update, nextSock));
      nextSock.ev.on("connection.update", async (update: any) => {
        if (currentGeneration !== generation) return;
        if (update.qr) {
          currentQr = await qrcode.toDataURL(update.qr);
          status = "waiting_qr";
        }
        if (update.connection === "open") { status = "connected"; currentQr = ""; lastError = null; }
        if (update.connection === "connecting" && status !== "waiting_qr") status = "starting";
        if (update.connection === "close") {
          const code = (update.lastDisconnect?.error as Boom | undefined)?.output?.statusCode;
          sock = null;
          if (code === DisconnectReason.loggedOut) {
            status = "logged_out";
            currentQr = "";
            lastError = "A sessão foi desconectada pelo WhatsApp. Conecte novamente para gerar um novo QR.";
            return;
          }
          status = "reconnecting";
          lastError = "Conexão interrompida. Nova tentativa agendada.";
          reconnectTimer = setTimeout(() => void start().catch(() => undefined), 5_000);
        }
      });
    } catch (error) {
      status = "failed";
      lastError = error instanceof Error ? error.message : "Falha ao iniciar o WhatsApp.";
      console.error({ event: "whatsapp.start_failed", component: "main-session", ...errorFields(error) });
      throw error;
    } finally {
      starting = false;
    }
  }

  async function logout() {
    generation += 1;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    await stopSocket(true);
    await auth.clearAuth();
    auth = await useSupabaseAuthState();
    status = "logged_out";
    currentQr = "";
    starting = false;
  }

  async function restart() {
    generation += 1;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    await stopSocket(false);
    await start(true);
  }

  async function refreshGroups() {
    if (!sock || status !== "connected") throw new Error("WhatsApp desconectado.");
    const groups = await discoverParticipatingGroups(sock);
    const rows = await Promise.all(groups.map((group) => groupToStoredRow(sock, group)));
    if (rows.length) {
      const { error } = await supabase.from("grupos").upsert(rows, { onConflict: "group_jid" });
      if (error) throw new Error(`Falha ao salvar os grupos: ${error.message}`);
    }
    return rows;
  }

  async function resolveGroupInvite(inviteUrl: string) {
    if (!sock || status !== "connected") throw new Error("WhatsApp desconectado.");
    const row = await groupToStoredRow(sock, await discoverGroupByInvite(sock, inviteUrl));
    const { error } = await supabase.from("grupos").upsert(row, { onConflict: "group_jid" });
    if (error) throw new Error(`Falha ao salvar o grupo: ${error.message}`);
    return row;
  }

  async function syncGroups(groupJids: string[]) {
    if (!sock || status !== "connected") throw new Error("WhatsApp desconectado.");
    return syncGroupMetadata(sock, groupJids);
  }

  return {
    start,
    restart,
    logout,
    refreshGroups,
    resolveGroupInvite,
    syncGroups,
    get sock() { return sock; },
    getStatus: () => status,
    getQr: () => currentQr,
    getLastError: () => lastError
  };
}
