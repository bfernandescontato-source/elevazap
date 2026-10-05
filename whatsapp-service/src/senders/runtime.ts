import { supabase } from "../supabase.js";
import { createWhatsAppSession, type WhatsAppSession } from "../whatsapp/session.js";
import { discoverGroupByInvite, discoverParticipatingGroups, groupToStoredRow } from "../groups/discovery.js";
import { regenerateGroupInviteLinks, syncGroupMetadata, updateGroupProfiles, type GroupProfileUpdate } from "../groups/sync.js";
import { scheduleParticipantEventSync } from "../groups/events.js";
import { monitorOfferMessages } from "../offers/whatsapp-monitor.js";
import { env } from "../env.js";

type SenderSession = {
  id: string;
  sessionName: string;
  label: string;
  session: WhatsAppSession;
  accountId: string;
  leaseVersion: number;
};

export type OwnedSenderLease = { whatsapp_session_id: string; account_id: string; lease_version: number };

const senders = new Map<string, SenderSession>();
// Última mensagem de grupo recebida e início de cada sessão: um número pode
// ficar "conectado" sem receber nada (socket surdo). Visto em 29/09 na conta
// Rosikelly: o Piloto parou quando o grupo fonte passou a depender só dele.
const lastGroupMessageAt = new Map<string, number>();
const sessionStartedAt = new Map<string, number>();
const lastDeafRestartAt = new Map<string, number>();
// Último momento em que QUALQUER número viu mensagem em cada grupo: separa
// "grupo quieto" (madrugada) de "número surdo".
const groupLastSeenAt = new Map<string, number>();

async function persistRuntimeStatus(senderId: string, leaseVersion: number, status: string, error: string | null) {
  const persistedStatus = status === "idle" ? "disconnected" : status;
  const { error: persistError } = await supabase.rpc("set_whatsapp_session_runtime_status", {
    p_worker_id: env.INSTANCE_ID,
    p_session_id: senderId,
    p_lease_version: leaseVersion,
    p_status: persistedStatus,
    p_error: error
  });
  if (persistError) throw persistError;
}

// Sessões em criação por número. createWhatsAppSession demora (credenciais +
// versão do WhatsApp) e o mapa `senders` só recebe a sessão no fim: duas
// chamadas ao mesmo tempo (renovação de lease + QR pelo painel) criavam duas
// sessões e a primeira ficava órfã, fora do mapa, sem ninguém para pará-la,
// pedindo QR a cada ~3 min para sempre (conta cc8e9296, 05/10).
const startingSenders = new Map<string, Promise<SenderSession>>();

function startSender(sender: { id: string; session_name: string; label: string; account_id: string }, leaseVersion: number) {
  const pending = startingSenders.get(sender.session_name);
  if (pending) return pending;
  const promise = startSenderNow(sender, leaseVersion).finally(() => startingSenders.delete(sender.session_name));
  startingSenders.set(sender.session_name, promise);
  return promise;
}

async function startSenderNow(sender: { id: string; session_name: string; label: string; account_id: string }, leaseVersion: number) {
  const current = senders.get(sender.session_name);
  if (current?.leaseVersion === leaseVersion) return current;
  if (current) {
    await current.session.stop();
    senders.delete(sender.session_name);
  }

  const session = await createWhatsAppSession(
    sender.session_name,
    async (messages, upsertType) => {
      const groupMessages = messages.filter((message) => String(message?.key?.remoteJid || "").endsWith("@g.us"));
      if (groupMessages.length) {
        lastGroupMessageAt.set(sender.session_name, Date.now());
        for (const message of groupMessages) groupLastSeenAt.set(String(message.key.remoteJid), Date.now());
        console.info({
          event: "pilot_group_messages_observed",
          component: "offer-autopilot",
          session_name: sender.session_name,
          account_id: sender.account_id,
          upsert_type: upsertType || "unknown",
          message_count: groupMessages.length,
          group_ids: Array.from(new Set(groupMessages.map((message) => String(message.key.remoteJid)))),
          from_me_count: groupMessages.filter((message) => Boolean(message?.key?.fromMe)).length
        });
      }
      if (upsertType === "notify") await monitorOfferMessages(supabase, { id: sender.id, accountId: sender.account_id }, messages);
    },
    async (update, sock) => scheduleParticipantEventSync(sender.id, update, sock),
    sender.account_id,
    (status, error) => persistRuntimeStatus(sender.id, leaseVersion, status, error)
  );
  const managed = { id: sender.id, sessionName: sender.session_name, label: sender.label, session, accountId: sender.account_id, leaseVersion };
  senders.set(sender.session_name, managed);
  sessionStartedAt.set(sender.session_name, Date.now());
  console.log(`[sender] Session started ${sender.label} (${sender.session_name})`);
  return managed;
}

export async function syncSenderSessionOwnership() {
  const { data: leases, error } = await supabase.rpc("acquire_whatsapp_session_leases", {
    p_worker_id: env.INSTANCE_ID,
    p_limit: env.MAX_SESSIONS_PER_WORKER,
    p_ttl_seconds: env.SESSION_LEASE_TTL_SECONDS
  });
  if (error) throw error;
  const owned = (leases || []) as OwnedSenderLease[];
  const ownedIds = new Set(owned.map((lease) => lease.whatsapp_session_id));
  for (const managed of Array.from(senders.values())) {
    if (!ownedIds.has(managed.id)) {
      await managed.session.stop();
      senders.delete(managed.sessionName);
    }
  }
  if (!owned.length) return owned;
  const { data: rows, error: senderError } = await supabase.from("whatsapp_senders").select("*")
    .in("id", owned.map((lease) => lease.whatsapp_session_id));
  if (senderError) throw senderError;
  const leaseById = new Map(owned.map((lease) => [lease.whatsapp_session_id, lease]));
  for (const sender of rows || []) {
    const lease = leaseById.get(sender.id);
    if (lease) await startSender(sender, lease.lease_version).catch((currentError) =>
      console.error(`[sender] boot failed ${sender.session_name}`, currentError)
    );
  }
  return owned;
}

export async function bootSenderSessions() { return syncSenderSessionOwnership(); }

export async function renewOwnedSenderLeases() {
  const leases = Array.from(senders.values()).map((managed) => ({ whatsapp_session_id: managed.id, lease_version: managed.leaseVersion }));
  if (!leases.length) return [] as OwnedSenderLease[];
  const { data, error } = await supabase.rpc("renew_whatsapp_session_leases", {
    p_worker_id: env.INSTANCE_ID,
    p_leases: leases,
    p_ttl_seconds: env.SESSION_LEASE_TTL_SECONDS
  });
  if (error) throw error;
  const renewed = (data || []) as Array<{ whatsapp_session_id: string; lease_version: number }>;
  const renewedIds = new Set(renewed.map((lease) => lease.whatsapp_session_id));
  for (const managed of Array.from(senders.values())) {
    if (!renewedIds.has(managed.id)) {
      await managed.session.stop();
      senders.delete(managed.sessionName);
      continue;
    }
    await persistRuntimeStatus(managed.id, managed.leaseVersion, managed.session.getStatus(), managed.session.getLastError());
  }
  return renewed;
}

export function getOwnedSenderLeases() {
  return Array.from(senders.values()).map((managed) => ({
    whatsapp_session_id: managed.id,
    account_id: managed.accountId,
    lease_version: managed.leaseVersion,
    session_name: managed.sessionName,
    status: managed.session.getStatus()
  }));
}

export async function startSenderSessionByName(sessionName: string) {
  const { data: sender } = await supabase.from("whatsapp_senders").select("*").eq("session_name", sessionName).maybeSingle();
  if (!sender) throw new Error("Número não encontrado.");
  const { data: leases, error: leaseError } = await supabase.rpc("acquire_whatsapp_session_lease", {
    p_worker_id: env.INSTANCE_ID,
    p_session_id: sender.id,
    p_ttl_seconds: env.SESSION_LEASE_TTL_SECONDS
  });
  if (leaseError) throw leaseError;
  const lease = (leases || [])[0] as OwnedSenderLease | undefined;
  if (!lease) throw new Error("Este número está sendo gerenciado por outra instância. Tente novamente em alguns segundos.");
  const current = senders.get(sessionName);
  if (current) {
    const status = current.session.getStatus();
    if (["starting", "waiting_qr", "connected", "reconnecting"].includes(status)) return current;
    await current.session.logout();
    senders.delete(sessionName);
  }
  return startSender(sender, lease.lease_version);
}

export async function restartSenderSessionByName(sessionName: string) {
  const { data: sender } = await supabase.from("whatsapp_senders").select("*").eq("session_name", sessionName).maybeSingle();
  if (!sender) throw new Error("Número não encontrado.");
  const { data: leases, error: leaseError } = await supabase.rpc("acquire_whatsapp_session_lease", {
    p_worker_id: env.INSTANCE_ID,
    p_session_id: sender.id,
    p_ttl_seconds: env.SESSION_LEASE_TTL_SECONDS
  });
  if (leaseError) throw leaseError;
  const lease = (leases || [])[0] as OwnedSenderLease | undefined;
  if (!lease) throw new Error("Este número está sendo gerenciado por outra instância. Tente novamente em alguns segundos.");
  const current = senders.get(sessionName);
  if (current) {
    await current.session.stop();
    senders.delete(sessionName);
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return startSender(sender, lease.lease_version);
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

export async function regenerateSenderGroupInviteLinks(sessionName: string, groupJids: string[]) {
  const sock = getSenderSock(sessionName);
  if (!sock) throw new Error("Número de disparo desconectado.");
  if (!senders.has(sessionName)) throw new Error("Sessão não pertence a uma conta.");
  return regenerateGroupInviteLinks(sock, groupJids);
}

export async function updateSenderGroupProfiles(sessionName: string, groupJids: string[], update: GroupProfileUpdate) {
  const sock = getSenderSock(sessionName);
  if (!sock) throw new Error("Número de disparo desconectado.");
  if (!senders.has(sessionName)) throw new Error("Sessão não pertence a uma conta.");
  return updateGroupProfiles(sock, groupJids, update);
}

export async function listSenderGroupContacts(sessionName: string, groupJid: string) {
  if (!/^\d+(-\d+)?@g\.us$/.test(groupJid)) throw new Error("Grupo inválido.");
  const sock = getSenderSock(sessionName);
  if (!sock) throw new Error("Número de disparo desconectado.");
  const metadata = await sock.groupMetadata(groupJid);
  if (!Array.isArray(metadata?.participants)) throw new Error("O WhatsApp não retornou os participantes deste grupo.");

  const contacts = metadata.participants.map((participant: any) => {
    const candidates = [participant?.phoneNumber, participant?.jid, participant?.id]
      .filter((value): value is string => typeof value === "string");
    const phoneJid = candidates.find((value) => value.endsWith("@s.whatsapp.net")) || "";
    const phone = phoneJid.split("@")[0]?.split(":")[0]?.replace(/\D/g, "") || "";
    return {
      phone,
      whatsapp_id: String(participant?.id || participant?.jid || ""),
      role: participant?.admin === "superadmin" ? "proprietario" : participant?.admin === "admin" ? "administrador" : "participante"
    };
  });

  return { group_jid: groupJid, group_name: String(metadata.subject || groupJid), contacts };
}

/**
 * Reinicia o número se ele está "conectado" mas não recebe mensagem de grupo há
 * `quietMs` (reconexão sem QR, alguns segundos). Sessão recém-iniciada ou fora do
 * ar fica como está. Devolve se reiniciou.
 */
export async function ensureSenderListening(sessionName: string, quietMs: number, reason: string) {
  const managed = senders.get(sessionName);
  if (!managed || managed.session.getStatus() !== "connected") return { restarted: false, reason: "not_connected" };
  const now = Date.now();
  const heard = Math.max(lastGroupMessageAt.get(sessionName) ?? 0, sessionStartedAt.get(sessionName) ?? 0);
  if (now - heard < quietMs) return { restarted: false, reason: "listening" };
  console.warn({ event: "sender_deaf_restart", component: "offer-autopilot", session_name: sessionName, account_id: managed.accountId, reason, quiet_minutes: Math.round((now - heard) / 60_000) });
  lastDeafRestartAt.set(sessionName, now);
  await restartSenderSessionByName(sessionName);
  return { restarted: true, reason: "quiet" };
}

/**
 * Vigia: números de Piloto ligado que estão conectados e sem ouvir grupo nenhum
 * há 45 min são reiniciados (no máximo 1x a cada 3 h por número).
 */
export async function restartDeafPilotSenders() {
  if (!senders.size) return;
  const { data, error } = await supabase.from("offer_automations").select("id,whatsapp_sender_id").eq("enabled", true);
  if (error) throw error;
  const automationBySender = new Map<string, string>((data || []).filter((row: any) => row.whatsapp_sender_id).map((row: any) => [row.whatsapp_sender_id, row.id]));
  if (!automationBySender.size) return;
  const { data: sourceRows, error: sourcesError } = await supabase.from("automation_source_groups").select("automation_id,whatsapp_group_id")
    .eq("enabled", true).in("automation_id", Array.from(automationBySender.values()));
  if (sourcesError) throw sourcesError;
  const sourcesByAutomation = new Map<string, string[]>();
  for (const row of sourceRows || []) sourcesByAutomation.set(row.automation_id, [...(sourcesByAutomation.get(row.automation_id) || []), row.whatsapp_group_id]);
  const now = Date.now();
  for (const managed of Array.from(senders.values())) {
    const automationId = automationBySender.get(managed.id);
    if (!automationId) continue;
    if (now - (lastDeafRestartAt.get(managed.sessionName) ?? 0) < 3 * 60 * 60_000) continue;
    // Só é "surdo" se algum grupo fonte teve mensagem (vista por outro número) nos
    // últimos 45 min. Grupo quieto não justifica derrubar a conexão.
    const sources = sourcesByAutomation.get(automationId) || [];
    if (!sources.some((group) => now - (groupLastSeenAt.get(group) ?? 0) < 45 * 60_000)) continue;
    await ensureSenderListening(managed.sessionName, 45 * 60_000, "watchdog").catch((restartError) =>
      console.error({ event: "sender_deaf_restart_failed", session_name: managed.sessionName, error: restartError instanceof Error ? restartError.message : String(restartError) }));
  }
}
