"use client";

import { AppShell, DataTable, EmptyState, SearchInput, StatusBadge, useApi } from "@/components/ui";
import { ReactNode, useMemo, useState } from "react";

export default function EnviosPage() {
  const { data: individual } = useApi<any[]>("/api/envios", []);
  const { data: groups } = useApi<any[]>("/api/envios-grupo", []);
  const { data: batches } = useApi<any[]>("/api/lotes", []);
  const { data: campaigns } = useApi<any[]>("/api/campanhas", []);
  const { data: senderData } = useApi<{ senders: any[] }>("/api/whatsapp/senders", { senders: [] });
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [campaignId, setCampaignId] = useState("");
  const [senderId, setSenderId] = useState("");
  const [batchId, setBatchId] = useState("");
  const [date, setDate] = useState("");

  const rows = useMemo(() => {
    const batchMap = new Map(batches.map((batch) => [batch.id, batch]));
    const campaignMap = new Map(campaigns.map((campaign) => [campaign.id, campaign.nome]));
    const senderMap = new Map(senderData.senders.map((sender) => [sender.id, sender.label]));
    const all = [
      ...individual.map((item) => ({ ...item, recipient: item.nome || item.telefone_mascarado || "Destinatário", sender: senderMap.get(item.whatsapp_sender_id) || item.whatsapp_session_name || "Número principal", campaignId: "", campaign: "—", batchId: "", batch: "—", preview: item.mensagem_enviada })),
      ...groups.map((item) => { const batch = batchMap.get(item.lote_id); return { ...item, recipient: item.nome_grupo || item.group_jid, sender: senderMap.get(item.whatsapp_sender_id) || item.whatsapp_session_name || "Número principal", campaignId: batch?.campanha_id || "", campaign: campaignMap.get(batch?.campanha_id) || batch?.titulo || "—", batchId: item.lote_id, batch: batch?.titulo || item.lote_id, preview: item.texto || item.legenda || item.file_name }; })
    ];
    return all.filter((item) => {
      const createdDate = item.created_at ? String(item.created_at).slice(0, 10) : "";
      return (!query || JSON.stringify(item).toLowerCase().includes(query.toLowerCase())) && (!status || item.status === status) && (!campaignId || item.campaignId === campaignId) && (!senderId || item.whatsapp_sender_id === senderId) && (!batchId || item.batchId === batchId) && (!date || createdDate === date);
    });
  }, [individual, groups, batches, campaigns, senderData.senders, query, status, campaignId, senderId, batchId, date]);

  const formatDate = (value?: string) => value ? new Date(value).toLocaleString("pt-BR") : "—";
  return <AppShell title="Envios" subtitle="Registros individuais de mensagens">
    <div className="mb-5 space-y-3">
      <SearchInput placeholder="Pesquisar destinatário, grupo ou mensagem" value={query} onChange={(event) => setQuery(event.target.value)} />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Filter value={status} onChange={setStatus}><option value="">Todos os status</option><option value="pendente">Aguardando</option><option value="processando">Enviando</option><option value="sucesso">Enviado</option><option value="erro">Falhou</option><option value="incerto">Não confirmado</option></Filter>
        <Filter value={campaignId} onChange={setCampaignId}><option value="">Todas as campanhas</option>{campaigns.map((campaign) => <option key={campaign.id} value={campaign.id}>{campaign.nome}</option>)}</Filter>
        <Filter value={senderId} onChange={setSenderId}><option value="">Todos os números</option>{senderData.senders.map((sender) => <option key={sender.id} value={sender.id}>{sender.label}</option>)}</Filter>
        <Filter value={batchId} onChange={setBatchId}><option value="">Todos os lotes</option>{batches.map((batch) => <option key={batch.id} value={batch.id}>{batch.titulo || batch.id}</option>)}</Filter>
        <input type="date" value={date} onChange={(event) => setDate(event.target.value)} className="focus-ring h-11 rounded-lg border border-line bg-white px-3 text-sm" />
      </div>
    </div>
    {!rows.length ? <EmptyState title="Não há envios registrados." description="Os registros aparecerão aqui quando houver mensagens processadas." /> : <DataTable columns={["Destinatário ou grupo", "Número", "Campanha", "Lote", "Status", "Data e horário", "Erro", "Identificador"]} rows={rows.map((item) => [item.recipient, item.sender, item.campaign, item.batch, <StatusBadge key="status" status={item.status} />, formatDate(item.created_at), item.erro || "—", <span key="id" className="font-mono text-xs text-muted">{item.id}</span>])} />}
  </AppShell>;
}

function Filter({ value, onChange, children }: { value: string; onChange: (value: string) => void; children: ReactNode }) {
  return <select value={value} onChange={(event) => onChange(event.target.value)} className="focus-ring h-11 rounded-lg border border-line bg-white px-3 text-sm">{children}</select>;
}
