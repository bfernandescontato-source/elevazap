"use client";

import Link from "next/link";
import { AppShell, DataTable, EmptyState, ProgressBar, SearchInput, StatusBadge, useApi } from "@/components/ui";
import { useMemo, useState } from "react";

export default function LotesPage() {
  const { data: batches } = useApi<any[]>("/api/lotes", []);
  const { data: campaigns } = useApi<any[]>("/api/campanhas", []);
  const { data: senderData } = useApi<{ senders: any[] }>("/api/whatsapp/senders", { senders: [] });
  const [query, setQuery] = useState("");
  const rows = useMemo(() => {
    const campaignMap = new Map(campaigns.map((campaign) => [campaign.id, campaign.nome]));
    const senderMap = new Map(senderData.senders.map((sender) => [sender.id, sender.label]));
    return batches.filter((batch) => JSON.stringify(batch).toLowerCase().includes(query.toLowerCase())).map((batch) => ({ ...batch, campaign: campaignMap.get(batch.campanha_id) || "—", sender: senderMap.get(batch.whatsapp_sender_id) || batch.whatsapp_session_name || "Número principal" }));
  }, [batches, campaigns, senderData.senders, query]);
  const formatDate = (value?: string) => value ? new Date(value).toLocaleString("pt-BR") : "—";

  return <AppShell title="Lotes" subtitle="Agrupamentos de envios processados pelo sistema">
    <div className="mb-4"><SearchInput placeholder="Pesquisar lote, campanha ou número" value={query} onChange={(event) => setQuery(event.target.value)} /></div>
    {!rows.length ? <EmptyState title="Não há lotes registrados." description="Os lotes aparecerão aqui quando um disparo for criado." /> : <DataTable columns={["Lote", "Campanha", "Número", "Total", "Enviadas", "Pendentes", "Erros", "Status", "Criação", "Conclusão", "Ação"]} rows={rows.map((batch) => {
      const progress = batch.total ? Math.round(((batch.enviados || 0) + (batch.erros || 0)) / batch.total * 100) : 0;
      return [<div key="name" className="min-w-40"><div className="font-medium">{batch.titulo || batch.id}</div><ProgressBar value={progress} /></div>, batch.campaign, batch.sender, batch.total || 0, batch.enviados || 0, batch.pendentes || 0, batch.erros || 0, <StatusBadge key="status" status={batch.status} />, formatDate(batch.created_at), formatDate(batch.finished_at), <Link key="open" href={`/lotes/${batch.id}`} className="font-medium underline underline-offset-4">Abrir lote</Link>];
    })} />}
  </AppShell>;
}
