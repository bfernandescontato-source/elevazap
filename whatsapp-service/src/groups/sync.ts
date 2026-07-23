import { supabase } from "../supabase.js";

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

export async function syncGroupMetadata(sock: any, groupJids: string[]): Promise<SyncedGroup[]> {
  const uniqueJids = Array.from(new Set(groupJids.filter((jid) => /^\d+(-\d+)?@g\.us$/.test(jid))));
  const rows: SyncedGroup[] = [];

  for (const groupJid of uniqueJids) {
    const syncedAt = new Date().toISOString();
    try {
      const metadata = await sock.groupMetadata(groupJid);
      let photoUrl: string | null = null;
      let inviteUrl: string | null = null;
      let inviteError: string | null = null;
      if (!Array.isArray(metadata.participants)) {
        throw new Error("O WhatsApp não retornou a lista atual de participantes deste grupo.");
      }
      try { photoUrl = await sock.profilePictureUrl(groupJid, "image"); } catch {}
      try {
        const inviteCode = await sock.groupInviteCode(groupJid);
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
  if (validRows.length) {
    const { error } = await supabase.from("grupos").upsert(validRows, { onConflict: "group_jid" });
    if (error) console.error("group-metadata-upsert", error);
  }
  return rows;
}
