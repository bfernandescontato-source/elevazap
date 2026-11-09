// "Dividir os grupos entre meus números": cada número envia uma parte dos grupos
// ao mesmo tempo. Regras (iguais às do banco em create_pilot_offer_schedule_locked):
// - Só recebe um grupo o número que está no grupo (whatsapp_sender_grupos).
// - O número principal sempre pode receber os grupos em que está; os outros só
//   quando estão conectados e sem pausa.
// - Grupo em que só um número está fica com esse número.
// - Grupo sem nenhum número disponível fica com o principal (como sem divisão).
// - Os grupos com menos opções são distribuídos primeiro; cada grupo vai para o
//   número com menos grupos até ali; empate fica com o principal e depois com a
//   ordem dos números.

export type SplitGroup = { groupJid: string; memberSenderIds: string[] };
export type SplitInput = {
  groups: SplitGroup[];
  primarySenderId: string;
  /** Outros números da conta que podem enviar agora (conectados, sem pausa), na ordem de preferência. */
  availableSenderIds: string[];
};
export type SplitResult = { assignments: Map<string, string[]>; shares: Array<{ senderId: string; groups: number }>; largestShare: number; sendersUsed: number };

export function splitGroupsAcrossSenders(input: SplitInput): SplitResult {
  const order = [input.primarySenderId, ...input.availableSenderIds.filter((id) => id !== input.primarySenderId)];
  const rank = new Map(order.map((id, index) => [id, index]));
  const seen = new Set<string>();
  const prepared = input.groups.filter((group) => {
    if (seen.has(group.groupJid)) return false;
    seen.add(group.groupJid); return true;
  }).map((group) => {
    const members = new Set(group.memberSenderIds);
    const candidates = order.filter((id) => members.has(id));
    return { groupJid: group.groupJid, candidates };
  });
  prepared.sort((a, b) => (a.candidates.length || Infinity) - (b.candidates.length || Infinity) || (a.groupJid < b.groupJid ? -1 : a.groupJid > b.groupJid ? 1 : 0));

  const load = new Map<string, number>();
  const assignments = new Map<string, string[]>();
  for (const group of prepared) {
    let chosen = input.primarySenderId;
    if (group.candidates.length) {
      chosen = group.candidates.reduce((best, current) => {
        const diff = (load.get(current) || 0) - (load.get(best) || 0);
        return diff < 0 || (diff === 0 && (rank.get(current) ?? 99) < (rank.get(best) ?? 99)) ? current : best;
      });
    }
    load.set(chosen, (load.get(chosen) || 0) + 1);
    assignments.set(chosen, [...(assignments.get(chosen) || []), group.groupJid]);
  }
  const shares = order.filter((id) => assignments.has(id)).map((senderId) => ({ senderId, groups: assignments.get(senderId)!.length }));
  return { assignments, shares, largestShare: shares.reduce((max, share) => Math.max(max, share.groups), 0), sendersUsed: shares.length };
}

/** Membros por grupo a partir das linhas de whatsapp_sender_grupos. */
export function membershipByGroup(rows: Array<{ whatsapp_sender_id: string; group_jid: string }>, groupJids: string[]): SplitGroup[] {
  const members = new Map<string, string[]>();
  for (const row of rows) members.set(row.group_jid, [...(members.get(row.group_jid) || []), row.whatsapp_sender_id]);
  return groupJids.map((groupJid) => ({ groupJid, memberSenderIds: members.get(groupJid) || [] }));
}
