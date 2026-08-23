import { supabase } from "../supabase.js";
import { normalizeBrazilianPhone } from "../utils/phone.js";
import { extractInviteCode } from "./discovery.js";

type ParticipantUpdate = {
  id?: unknown;
  participants?: unknown;
  action?: unknown;
};

type CandidateRun = {
  id: string;
  phone: string;
  final_destination_url: string | null;
  final_link_clicked_at: string;
  joined_group_at: string | null;
};

export function brazilianPhoneVariants(value: string) {
  const normalized = normalizeBrazilianPhone(value);
  const variants = new Set([normalized]);
  const local = normalized.slice(4);
  if (local.length === 8) variants.add(`${normalized.slice(0, 4)}9${local}`);
  if (local.length === 9 && local.startsWith("9")) variants.add(`${normalized.slice(0, 4)}${local.slice(1)}`);
  return [...variants];
}

async function participantPhone(participantJid: string, groupJid: string, sock: any) {
  let phoneJid = participantJid;
  if (participantJid.endsWith("@lid")) {
    const metadata = await sock.groupMetadata(groupJid).catch(() => null);
    const participant = metadata?.participants?.find((item: any) => item?.id === participantJid || item?.lid === participantJid);
    phoneJid = participant?.jid || "";
  }
  const digits = phoneJid.split("@")[0]?.split(":")[0]?.replace(/\D/g, "") || "";
  if (!digits) return null;
  try { return normalizeBrazilianPhone(digits); } catch { return null; }
}

async function destinationMatchesGroup(destination: string, groupJid: string, sock: any) {
  try {
    const info = await sock.groupGetInviteInfo(extractInviteCode(destination));
    return info?.id === groupJid;
  } catch {
    return false;
  }
}

async function findCandidateRun(phone: string, groupJid: string, sock: any) {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1_000).toISOString();
  const { data, error } = await supabase.from("official_flow_runs")
    .select("id,phone,final_destination_url,final_link_clicked_at,joined_group_at")
    .in("phone", brazilianPhoneVariants(phone))
    .not("final_link_clicked_at", "is", null)
    .gte("final_link_clicked_at", since)
    .order("final_link_clicked_at", { ascending: false })
    .limit(10);
  if (error) throw error;

  for (const run of (data || []) as CandidateRun[]) {
    if (!run.final_destination_url || run.joined_group_at) continue;
    if (await destinationMatchesGroup(run.final_destination_url, groupJid, sock)) return run;
  }
  return null;
}

async function persistJoin(senderId: string | null, groupJid: string, participantJid: string, phone: string, sock: any) {
  const run = await findCandidateRun(phone, groupJid, sock);
  if (!run) return;

  const { data: click, error: clickError } = await supabase.from("official_final_link_clicks")
    .select("id")
    .eq("flow_run_id", run.id)
    .order("clicked_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (clickError) throw clickError;

  const occurredAt = new Date().toISOString();
  const { error: insertError } = await supabase.from("official_group_membership_events").insert({
    flow_run_id: run.id,
    final_link_click_id: click?.id || null,
    sender_id: senderId,
    group_jid: groupJid,
    participant_phone: phone,
    participant_jid: participantJid,
    action: "add",
    occurred_at: occurredAt
  });
  if (insertError) throw insertError;

  const { error: updateError } = await supabase.from("official_flow_runs")
    .update({ joined_group_at: occurredAt, joined_group_jid: groupJid })
    .eq("id", run.id)
    .is("joined_group_at", null);
  if (updateError) throw updateError;
}

// Best effort: qualquer falha aqui é isolada do sincronismo normal dos grupos.
export async function trackOfficialGroupJoin(senderId: string | null, update: ParticipantUpdate, sock: any) {
  const groupJid = typeof update.id === "string" ? update.id : "";
  if (update.action !== "add" || !/^\d+(-\d+)?@g\.us$/.test(groupJid) || !Array.isArray(update.participants)) return;

  for (const participant of update.participants) {
    if (typeof participant !== "string") continue;
    const phone = await participantPhone(participant, groupJid, sock);
    if (phone) await persistJoin(senderId, groupJid, participant, phone, sock);
  }
}
