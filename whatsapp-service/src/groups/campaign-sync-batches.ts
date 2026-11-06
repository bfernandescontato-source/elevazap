type Sender = { id: string; account_id: string; session_name: string };
type Campaign = { id: string; account_id: string; whatsapp_sender_id?: string | null; campanha_grupos?: { group_jid: string }[] | null };
type Batch = { accountId: string; senderId: string | null; sessionName: string | null; campaignIds: string[]; groupJids: Set<string> };

export function campaignSyncBatches(campaigns: Campaign[], senders: Sender[]) {
  const firstSenderByAccount = new Map<string, Sender>();
  const sendersById = new Map(senders.map(sender => [sender.id, sender]));
  for (const sender of senders) if (!firstSenderByAccount.has(sender.account_id)) firstSenderByAccount.set(sender.account_id, sender);
  const batches = new Map<string, Batch>();
  for (const campaign of campaigns) {
    // Respeita o número responsável; o primeiro da conta é apenas o fallback legado.
    const candidate = campaign.whatsapp_sender_id ? sendersById.get(campaign.whatsapp_sender_id) : firstSenderByAccount.get(campaign.account_id);
    const sender = candidate?.account_id === campaign.account_id ? candidate : undefined;
    const key = `${campaign.account_id}:${sender?.session_name || "sem-sessao"}`;
    const batch = batches.get(key) || { accountId: campaign.account_id, senderId: sender?.id || null, sessionName: sender?.session_name || null, campaignIds: [], groupJids: new Set<string>() };
    batch.campaignIds.push(campaign.id);
    for (const group of campaign.campanha_grupos || []) batch.groupJids.add(group.group_jid);
    batches.set(key, batch);
  }
  return batches;
}
