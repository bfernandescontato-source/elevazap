import { supabaseAdmin } from "@/lib/supabase";
import { membershipByGroup, splitGroupsAcrossSenders, type SplitResult } from "../split";

type SenderRow = {
  id: string; label: string | null; session_name: string | null; connection_status: string | null;
  connection_heartbeat_at: string | null; circuit_state: string | null; circuit_open_until: string | null;
};
export type SenderSplitPlan = SplitResult & { senders: Map<string, { label: string; session_name: string | null }> };

const CHUNK = 100;

// Mesmo critério de "pode enviar agora" de claim_whatsapp_jobs: conectado, batimento
// recente, disjuntor fechado e sem pausa operacional.
function canSendNow(sender: SenderRow, paused: Set<string>, now = Date.now()) {
  if (sender.connection_status !== "connected" || paused.has(sender.id)) return false;
  if (sender.connection_heartbeat_at && Date.parse(sender.connection_heartbeat_at) <= now - 2 * 60_000) return false;
  if (sender.circuit_state === "open" && sender.circuit_open_until && Date.parse(sender.circuit_open_until) > now) return false;
  return true;
}

/**
 * Divide os grupos entre os números da conta. Sempre com a conta da sessão e filtro
 * explícito (privilégio elevado). Nunca dá um grupo a número que não está nele.
 */
export async function planSenderSplit(accountId: string, primarySenderId: string, groupJids: string[]): Promise<SenderSplitPlan> {
  const sb = supabaseAdmin();
  const unique = Array.from(new Set(groupJids));
  const [{ data: senders, error: sendersError }, { data: pauses }] = await Promise.all([
    sb.from("whatsapp_senders").select("id,label,session_name,connection_status,connection_heartbeat_at,circuit_state,circuit_open_until")
      .eq("account_id", accountId).order("created_at", { ascending: true }),
    sb.from("whatsapp_sender_pauses").select("whatsapp_sender_id").eq("account_id", accountId)
  ]);
  if (sendersError) throw sendersError;
  const rows = (senders || []) as SenderRow[];
  if (!rows.some((sender) => sender.id === primarySenderId)) throw new Error("Número responsável não encontrado.");
  const paused = new Set((pauses || []).map((row: any) => row.whatsapp_sender_id as string));
  const available = rows.filter((sender) => sender.id !== primarySenderId && canSendNow(sender, paused)).map((sender) => sender.id);

  const memberships: Array<{ whatsapp_sender_id: string; group_jid: string }> = [];
  if (available.length) {
    for (let start = 0; start < unique.length; start += CHUNK) {
      const { data, error } = await sb.from("whatsapp_sender_grupos").select("whatsapp_sender_id,group_jid")
        .eq("account_id", accountId).in("whatsapp_sender_id", [primarySenderId, ...available]).in("group_jid", unique.slice(start, start + CHUNK));
      if (error) throw error;
      memberships.push(...((data || []) as typeof memberships));
    }
  }
  const result = splitGroupsAcrossSenders({ groups: membershipByGroup(memberships, unique), primarySenderId, availableSenderIds: available });
  return { ...result, senders: new Map(rows.map((sender) => [sender.id, { label: sender.label || "Número", session_name: sender.session_name }])) };
}
