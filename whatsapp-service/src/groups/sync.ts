import { supabase } from "../supabase.js";
import { env } from "../env.js";
import { dbResult } from "../utils/db.js";
import { withTimeout } from "../utils/timeout.js";

export type SyncedGroup = {
  group_jid: string;
  nome?: string;
  qtd_membros?: number;
  sou_admin?: boolean;
  foto_url?: string | null;
  invite_url?: string | null;
  synced_at: string;
  participant_error?: string | null;
  invite_error?: string | null;
};

export async function syncGroupMetadata(sock: any, groupJids: string[], accountId?: string): Promise<SyncedGroup[]> {
  const uniqueJids = Array.from(new Set(groupJids.filter((jid) => /^\d+(-\d+)?@g\.us$/.test(jid))));
  const rows: SyncedGroup[] = [];

  for (const groupJid of uniqueJids) {
    const syncedAt = new Date().toISOString();
    try {
      const metadata = await withTimeout<any>("groups.metadata", env.GROUP_SYNC_TIMEOUT_MS, sock.groupMetadata(groupJid));
      let photoUrl: string | null = null;
      let inviteUrl: string | null = null;
      let inviteError: string | null = null;
      if (!Array.isArray(metadata.participants)) {
        throw new Error("O WhatsApp não retornou a lista atual de participantes deste grupo.");
      }
      try { photoUrl = await withTimeout("groups.photo", env.GROUP_SYNC_TIMEOUT_MS, sock.profilePictureUrl(groupJid, "image")); } catch {}
      try {
        const inviteCode = await withTimeout("groups.invite", env.GROUP_SYNC_TIMEOUT_MS, sock.groupInviteCode(groupJid));
        if (inviteCode) inviteUrl = `https://chat.whatsapp.com/${inviteCode}`;
      } catch (error: any) {
        inviteError = error?.message || "Não foi possível obter o link de convite. Verifique se o número é administrador do grupo.";
      }

      rows.push({
        group_jid: groupJid,
        nome: metadata.subject,
        qtd_membros: metadata.participants.length,
        sou_admin: metadata.participants?.some((participant: any) => participant.id === sock.user?.id && ["admin", "superadmin"].includes(participant.admin)),
        foto_url: photoUrl,
        invite_url: inviteUrl,
        synced_at: syncedAt,
        participant_error: null,
        invite_error: inviteError
      });
    } catch (error: any) {
      rows.push({
        group_jid: groupJid,
        synced_at: syncedAt,
        participant_error: error?.message || "Não foi possível consultar os participantes deste grupo.",
        invite_error: null
      });
    }
  }

  const validRows = rows.filter((row) => row.qtd_membros !== undefined).map((row) => ({
    group_jid: row.group_jid,
    nome: row.nome,
    qtd_membros: row.qtd_membros,
    sou_admin: row.sou_admin,
    foto_url: row.foto_url,
    updated_at: row.synced_at
  }));
  if (validRows.length && accountId) {
    await dbResult("groups.upsert", supabase.from("grupos").upsert(validRows.map((row) => ({ ...row, account_id: accountId })), { onConflict: "account_id,group_jid" }));
  }
  return rows;
}

/** Revoga os convites atuais e cria links novos. Requer que o número seja administrador. */
export async function regenerateGroupInviteLinks(sock: any, groupJids: string[]): Promise<SyncedGroup[]> {
  const uniqueJids = Array.from(new Set(groupJids.filter((jid) => /^\d+(-\d+)?@g\.us$/.test(jid))));
  const rows: SyncedGroup[] = [];
  for (const groupJid of uniqueJids) {
    const syncedAt = new Date().toISOString();
    try {
      const inviteCode = await withTimeout("groups.revoke-invite", env.GROUP_SYNC_TIMEOUT_MS, sock.groupRevokeInvite(groupJid));
      if (!inviteCode) throw new Error("O WhatsApp não retornou o novo link de convite.");
      rows.push({ group_jid: groupJid, invite_url: `https://chat.whatsapp.com/${inviteCode}`, synced_at: syncedAt, participant_error: null, invite_error: null });
    } catch (error: any) {
      rows.push({
        group_jid: groupJid,
        synced_at: syncedAt,
        participant_error: null,
        invite_error: error?.message || "Não foi possível gerar um novo link. Verifique se o número é administrador do grupo."
      });
    }
  }
  return rows;
}
