import { supabase } from "../supabase.js";
import { createWhatsAppSession, type WhatsAppSession } from "../whatsapp/session.js";
import { discoverGroupByInvite, discoverParticipatingGroups, groupToStoredRow } from "../groups/discovery.js";
import { syncGroupMetadata } from "../groups/sync.js";
import { scheduleParticipantEventSync } from "../groups/events.js";

type SenderSession = {
  id: string;
  sessionName: string;
  label: string;
  session: WhatsAppSession;
  accountId: string;
};

const senders = new Map<string, SenderSession>();

async function startSender(sender: { id: string; session_name: string; label: string; account_id: string }) {
  const current = senders.get(sender.session_name);
  if (current) return current;

  const session = await createWhatsAppSession(
    sender.session_name,
    async () => undefined,
    async (update, sock) => scheduleParticipantEventSync(sender.id, update, sock),
    sender.account_id
  );
  const managed = { id: sender.id, sessionName: sender.session_name, label: sender.label, session, accountId: sender.account_id };
  senders.set(sender.session_name, managed);
  console.log(`[sender] Session started ${sender.label} (${sender.session_name})`);
  return managed;
}

export async function bootSenderSessions() {
  const { data } = await supabase.from("whatsapp_senders").select("*").order("created_at", { ascending: true });
  for (const sender of data || []) {
    await startSender(sender).catch((error) => console.error(`[sender] boot failed ${sender.session_name}`, error));
  }
}

export async function startSenderSessionByName(sessionName: string) {
  const { data: sender } = await supabase.from("whatsapp_senders").select("*").eq("session_name", sessionName).maybeSingle();
  if (!sender) throw new Error("Número não encontrado.");
  const current = senders.get(sessionName);
  if (current) {
    const status = current.session.getStatus();
    if (["starting", "waiting_qr", "connected", "reconnecting"].includes(status)) return current;
    await current.session.logout();
    senders.delete(sessionName);
  }
  return startSender(sender);
}

export async function disconnectSenderSession(sessionName: string) {
  const managed = senders.get(sessionName);
  if (!managed) return;
  await managed.session.logout();
  senders.delete(sessionName);
}

export function getSenderStatus(sessionName: string) {
  const managed = senders.get(sessionName);
  if (!managed) return { status: "disconnected", qr: "" };
  const user = managed.session.sock?.user;
  const phoneNumber = user?.id ? user.id.split(":")[0].split("@")[0] : "";
  return {
    status: managed.session.getStatus(),
    qr: managed.session.getQr(),
    error: managed.session.getLastError(),
    phone_number: phoneNumber,
    display_name: user?.name || ""
  };
}

export function getSenderSock(sessionName: string, accountId?: string) {
  const managed = senders.get(sessionName);
  if (!managed || (accountId && managed.accountId !== accountId) || managed.session.getStatus() !== "connected") return null;
  return managed.session.sock;
}

export function getSenderSockById(senderId: string, accountId?: string) {
  const managed = Array.from(senders.values()).find((item) =>
    item.id === senderId && (!accountId || item.accountId === accountId) && item.session.getStatus() === "connected"
  );
  return managed?.session.sock || null;
}

export function hasConnectedSender() {
  return Array.from(senders.values()).some((managed) => managed.session.getStatus() === "connected");
}

export function getSenderRuntimeStats() {
  const sessions = Array.from(senders.values());
  return {
    total: sessions.length,
    connected: sessions.filter((item) => item.session.getStatus() === "connected").length,
    waiting_qr: sessions.filter((item) => item.session.getStatus() === "waiting_qr").length,
    reconnecting: sessions.filter((item) => item.session.getStatus() === "reconnecting").length,
    failed: sessions.filter((item) => ["failed", "logged_out"].includes(item.session.getStatus())).length
  };
}

export async function refreshSenderGroups(sessionName: string) {
  const sock = getSenderSock(sessionName);
  if (!sock) throw new Error("Número de disparo desconectado.");
  const managed = senders.get(sessionName);
  if (!managed) throw new Error("Sessão não pertence a uma conta.");
  const groups = await discoverParticipatingGroups(sock);
  const rows = (await Promise.all(groups.map((group) => groupToStoredRow(sock, group, { includePhoto: false })))).map((row) => ({ ...row, account_id: managed.accountId }));
  if (rows.length) {
    const { error } = await supabase.from("grupos").upsert(rows, { onConflict: "account_id,group_jid" });
    if (error) throw new Error(`Falha ao salvar os grupos: ${error.message}`);
  }
  return rows;
}

export async function resolveSenderGroupInvite(sessionName: string, inviteUrl: string) {
  const sock = getSenderSock(sessionName);
  if (!sock) throw new Error("Número de disparo desconectado.");
  const managed = senders.get(sessionName);
  if (!managed) throw new Error("Sessão não pertence a uma conta.");
  const row = { ...(await groupToStoredRow(sock, await discoverGroupByInvite(sock, inviteUrl))), account_id: managed.accountId };
  const { error } = await supabase.from("grupos").upsert(row, { onConflict: "account_id,group_jid" });
  if (error) throw new Error(`Falha ao salvar o grupo: ${error.message}`);
  return row;
}

export async function syncSenderGroups(sessionName: string, groupJids: string[]) {
  const sock = getSenderSock(sessionName);
  if (!sock) throw new Error("Número de disparo desconectado.");
  const managed = senders.get(sessionName);
  if (!managed) throw new Error("Sessão não pertence a uma conta.");
  return syncGroupMetadata(sock, groupJids, managed.accountId);
}
