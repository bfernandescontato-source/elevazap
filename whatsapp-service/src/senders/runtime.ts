import { supabase } from "../supabase.js";
import { createSupportSession, type SupportSession } from "../support/session.js";
import { discoverGroupByInvite, discoverParticipatingGroups, groupToStoredRow } from "../groups/discovery.js";
import { syncGroupMetadata } from "../groups/sync.js";
import { scheduleParticipantEventSync } from "../groups/events.js";

type SenderSession = {
  id: string;
  sessionName: string;
  label: string;
  session: SupportSession;
};

const senders = new Map<string, SenderSession>();

async function startSender(sender: { id: string; session_name: string; label: string }) {
  const current = senders.get(sender.session_name);
  if (current) return current;

  const session = await createSupportSession(
    sender.session_name,
    async () => undefined,
    async (update, sock) => scheduleParticipantEventSync(sender.id, update, sock)
  );
  const managed = { id: sender.id, sessionName: sender.session_name, label: sender.label, session };
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
  const user = managed.session.sock.user;
  const phoneNumber = user?.id ? user.id.split(":")[0].split("@")[0] : "";
  return {
    status: managed.session.getStatus(),
    qr: managed.session.getQr(),
    phone_number: phoneNumber,
    display_name: user?.name || ""
  };
}

export function getSenderSock(sessionName: string) {
  const managed = senders.get(sessionName);
  if (!managed || managed.session.getStatus() !== "connected") return null;
  return managed.session.sock;
}

export function getFirstConnectedSenderSock() {
  for (const managed of senders.values()) {
    if (managed.session.getStatus() === "connected") {
      return { sock: managed.session.sock, sessionName: managed.sessionName, label: managed.label };
    }
  }
  return null;
}

export async function refreshSenderGroups(sessionName: string) {
  const sock = getSenderSock(sessionName);
  if (!sock) throw new Error("Número de disparo desconectado.");
  const groups = await discoverParticipatingGroups(sock);
  const rows = await Promise.all(groups.map((group) => groupToStoredRow(sock, group)));
  if (rows.length) {
    const { error } = await supabase.from("grupos").upsert(rows, { onConflict: "group_jid" });
    if (error) throw new Error(`Falha ao salvar os grupos: ${error.message}`);
  }
  return rows;
}

export async function resolveSenderGroupInvite(sessionName: string, inviteUrl: string) {
  const sock = getSenderSock(sessionName);
  if (!sock) throw new Error("Número de disparo desconectado.");
  const row = await groupToStoredRow(sock, await discoverGroupByInvite(sock, inviteUrl));
  const { error } = await supabase.from("grupos").upsert(row, { onConflict: "group_jid" });
  if (error) throw new Error(`Falha ao salvar o grupo: ${error.message}`);
  return row;
}

export async function syncSenderGroups(sessionName: string, groupJids: string[]) {
  const sock = getSenderSock(sessionName);
  if (!sock) throw new Error("Número de disparo desconectado.");
  return syncGroupMetadata(sock, groupJids);
}
