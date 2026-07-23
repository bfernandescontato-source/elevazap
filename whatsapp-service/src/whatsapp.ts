import makeWASocket, { DisconnectReason, fetchLatestBaileysVersion } from "@whiskeysockets/baileys";
import { pino } from "pino";
import qrcode from "qrcode";
import { Boom } from "@hapi/boom";
import { supabase } from "./supabase.js";
import { useSupabaseAuthState } from "./auth/supabase-auth-state.js";
import { discoverGroupByInvite, discoverParticipatingGroups, groupToStoredRow } from "./groups/discovery.js";
import { syncGroupMetadata } from "./groups/sync.js";
import { scheduleParticipantEventSync } from "./groups/events.js";

export type WhatsAppRuntime = Awaited<ReturnType<typeof createWhatsAppRuntime>>;

export async function createWhatsAppRuntime() {
  let auth = await useSupabaseAuthState();
  let sock: any = null;
  let status: "connected" | "disconnected" | "connecting" = "connecting";
  let currentQr = "";
  let starting = false;

  async function finishLogout() {
    if (!sock) return;
    await Promise.race([
      sock.logout().catch(() => undefined),
      new Promise((resolve) => setTimeout(resolve, 4_000))
    ]);
  }

  async function start(fresh = false) {
    if (starting) return;
    starting = true;
    status = "connecting";
    currentQr = "";
    if (fresh) {
      await auth.clearAuth();
      auth = await useSupabaseAuthState();
    }
    const { version } = await fetchLatestBaileysVersion();
    sock?.end(undefined);
    sock = makeWASocket({
      version,
      auth: auth.state,
      printQRInTerminal: false,
      logger: pino({ level: "info" })
    });

    sock.ev.on("creds.update", auth.saveCreds);
    sock.ev.on("group-participants.update", (update: any) => scheduleParticipantEventSync(null, update, sock));
    sock.ev.on("connection.update", async (update: any) => {
      if (update.qr) currentQr = await qrcode.toDataURL(update.qr);
      if (update.connection === "open") { status = "connected"; currentQr = ""; }
      if (update.connection === "connecting") status = "connecting";
      if (update.connection === "close") {
        starting = false;
        status = "disconnected";
        const code = (update.lastDisconnect?.error as Boom | undefined)?.output?.statusCode;
        if (code !== DisconnectReason.loggedOut) setTimeout(start, 5000);
      }
    });
    starting = false;
  }

  async function logout() {
    await finishLogout();
    sock?.end(undefined);
    await auth.clearAuth();
    auth = await useSupabaseAuthState();
    status = "connecting";
    currentQr = "";
    starting = false;
    setTimeout(() => start(), 500);
  }

  async function restart() {
    await finishLogout();
    sock?.end(undefined);
    starting = false;
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
    getQr: () => currentQr
  };
}
