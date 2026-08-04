type GroupMetadata = {
  id?: string;
  subject?: string;
  participants?: unknown[];
  [key: string]: unknown;
};

export type StoredGroup = {
  group_jid: string;
  nome?: string;
  qtd_membros: number;
  sou_admin: boolean;
  foto_url?: string | null;
  updated_at: string;
};

function pause(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function extractInviteCode(value: string) {
  const input = value.trim();
  if (/^[A-Za-z0-9_-]{10,}$/.test(input)) return input;

  try {
    const url = new URL(input);
    if (url.hostname.toLowerCase() !== "chat.whatsapp.com") throw new Error();
    const code = url.pathname.split("/").filter(Boolean)[0] || "";
    if (/^[A-Za-z0-9_-]{10,}$/.test(code)) return code;
  } catch {}

  throw new Error("Cole um link de convite válido do WhatsApp.");
}

export async function groupToStoredRow(sock: any, group: GroupMetadata, options: { includePhoto?: boolean } = {}): Promise<StoredGroup> {
  if (!group.id) throw new Error("O WhatsApp não informou o identificador do grupo.");
  const participants = Array.isArray(group.participants) ? group.participants as any[] : [];
  const row: StoredGroup = {
    group_jid: group.id,
    nome: group.subject,
    qtd_membros: participants.length || Number(group.size || 0),
    sou_admin: participants.some((participant) => participant.id === sock.user?.id && ["admin", "superadmin"].includes(participant.admin)),
    updated_at: new Date().toISOString()
  };
  if (options.includePhoto !== false) {
    try { row.foto_url = await withTimeout("groups.photo", env.GROUP_SYNC_TIMEOUT_MS, sock.profilePictureUrl(group.id, "image")); } catch {}
  }
  return row;
}

export async function discoverGroupByInvite(sock: any, inviteUrl: string) {
  const metadata = await withTimeout<GroupMetadata>("groups.invite-info", env.GROUP_SYNC_TIMEOUT_MS, sock.groupGetInviteInfo(extractInviteCode(inviteUrl)));
  if (!metadata?.id || !metadata?.subject) throw new Error("Não foi possível identificar este grupo pelo link.");
  return metadata as GroupMetadata;
}

export async function discoverParticipatingGroups(
  sock: any,
  attempts = 2,
  waitMs = 700
): Promise<GroupMetadata[]> {
  const discovered = new Map<string, GroupMetadata>();
  let successfulAttempts = 0;
  let lastError: unknown;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const groups = await withTimeout<Record<string, GroupMetadata>>("groups.list", env.GROUP_SYNC_TIMEOUT_MS, sock.groupFetchAllParticipating());
      successfulAttempts += 1;
      for (const [jid, value] of Object.entries(groups || {})) {
        const group = value as GroupMetadata;
        const groupJid = group.id || jid;
        if (groupJid) discovered.set(groupJid, group);
      }
    } catch (error) {
      lastError = error;
    }

    if (attempt < attempts - 1 && waitMs > 0) await pause(waitMs);
  }

  if (!successfulAttempts) throw lastError || new Error("O WhatsApp não retornou os grupos.");

  const missingNames = Array.from(discovered.entries()).filter(([, group]) => !group.subject?.trim());
  let unresolvedNames = 0;
  for (let index = 0; index < missingNames.length; index += 4) {
    await Promise.all(missingNames.slice(index, index + 4).map(async ([groupJid, current]) => {
      try {
        const metadata = await withTimeout<GroupMetadata>("groups.metadata", env.GROUP_SYNC_TIMEOUT_MS, sock.groupMetadata(groupJid));
        discovered.set(groupJid, { ...current, ...metadata, id: metadata.id || groupJid });
      } catch {
        unresolvedNames += 1;
      }
    }));
  }
  if (unresolvedNames) console.warn(`[groups] ${unresolvedNames} grupo(s) continuam sem nome.`);

  console.log(`[groups] ${discovered.size} grupos encontrados em ${successfulAttempts} consulta(s).`);
  return Array.from(discovered.values());
}
import { env } from "../env.js";
import { withTimeout } from "../utils/timeout.js";
