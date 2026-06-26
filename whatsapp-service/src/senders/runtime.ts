import { supabase } from "../supabase.js";
import { createSupportSession, type SupportSession } from "../support/session.js";

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

  const session = await createSupportSession(sender.session_name, async () => undefined);
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
  return { status: managed.session.getStatus(), qr: managed.session.getQr() };
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
