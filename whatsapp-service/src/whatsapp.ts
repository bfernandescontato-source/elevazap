import makeWASocket, { DisconnectReason, fetchLatestBaileysVersion } from "@whiskeysockets/baileys";
import { pino } from "pino";
import qrcode from "qrcode";
import { Boom } from "@hapi/boom";
import { supabase } from "./supabase.js";
import { useSupabaseAuthState } from "./auth/supabase-auth-state.js";

export type WhatsAppRuntime = Awaited<ReturnType<typeof createWhatsAppRuntime>>;

export async function createWhatsAppRuntime() {
  const auth = await useSupabaseAuthState();
  let sock: any = null;
  let status: "connected" | "disconnected" | "connecting" = "connecting";
  let currentQr = "";

  async function start() {
    const { version } = await fetchLatestBaileysVersion();
    sock = makeWASocket({
      version,
      auth: auth.state,
      printQRInTerminal: false,
      logger: pino({ level: "info" })
    });

    sock.ev.on("creds.update", auth.saveCreds);
    sock.ev.on("connection.update", async (update: any) => {
      if (update.qr) currentQr = await qrcode.toDataURL(update.qr);
      if (update.connection === "open") { status = "connected"; currentQr = ""; }
      if (update.connection === "connecting") status = "connecting";
      if (update.connection === "close") {
        status = "disconnected";
        const code = (update.lastDisconnect?.error as Boom | undefined)?.output?.statusCode;
        if (code !== DisconnectReason.loggedOut) setTimeout(start, 5000);
      }
    });
  }

  async function logout() {
    await sock?.logout().catch(() => undefined);
    await auth.clearAuth();
    status = "disconnected";
    currentQr = "";
  }

  async function refreshGroups() {
    if (!sock || status !== "connected") throw new Error("WhatsApp desconectado.");
    const groups = await sock.groupFetchAllParticipating();
    const rows = await Promise.all(Object.values(groups).map(async (group: any) => {
      let foto_url = null;
      try { foto_url = await sock.profilePictureUrl(group.id, "image"); } catch {}
      return {
        group_jid: group.id,
        nome: group.subject,
        qtd_membros: group.participants?.length || 0,
        sou_admin: group.participants?.some((p: any) => p.id === sock.user?.id && ["admin", "superadmin"].includes(p.admin)),
        foto_url,
        updated_at: new Date().toISOString()
      };
    }));
    if (rows.length) await supabase.from("grupos").upsert(rows, { onConflict: "group_jid" });
    return rows;
  }

  return {
    start,
    logout,
    refreshGroups,
    get sock() { return sock; },
    getStatus: () => status,
    getQr: () => currentQr
  };
}
