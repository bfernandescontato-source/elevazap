import { supabase } from "../supabase.js";
import { syncGroupMetadata } from "./sync.js";

const pending = new Map<string, ReturnType<typeof setTimeout>>();

async function persistForCampaigns(senderId: string | null, groupJid: string, sock: any) {
  const [row] = await syncGroupMetadata(sock, [groupJid]);
  if (!row) return;

  const update: Record<string, unknown> = {
    participants_sync_error: row.participant_error || null,
    updated_at: new Date().toISOString()
  };
  if (row.qtd_membros !== undefined) {
    update.participant_count = row.qtd_membros;
    update.participants_synced_at = row.synced_at;
  }
  if (row.invite_url) update.invite_url = row.invite_url;

  await supabase.from("campanha_grupos").update(update).eq("group_jid", groupJid);
  await supabase.from("group_participant_syncs").insert({
    group_jid: groupJid,
    whatsapp_sender_id: senderId,
    participant_count: row.qtd_membros,
    status: row.participant_error ? "erro" : "sucesso",
    error: row.participant_error || row.invite_error || null,
    source: "baileys_group_participants_update",
    created_at: row.synced_at
  });
}

export function scheduleParticipantEventSync(senderId: string | null, update: any, sock: any) {
  const groupJid = typeof update?.id === "string" ? update.id : "";
  if (!/^\d+(-\d+)?@g\.us$/.test(groupJid)) return;

  const key = `${senderId || "principal"}:${groupJid}`;
  const current = pending.get(key);
  if (current) clearTimeout(current);
  pending.set(key, setTimeout(() => {
    pending.delete(key);
    persistForCampaigns(senderId, groupJid, sock).catch((error) => console.error("[groups] participant event sync error:", error));
  }, 1_500));
}
