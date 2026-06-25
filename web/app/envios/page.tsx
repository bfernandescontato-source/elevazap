"use client";

import { AppShell, DataTable, PhoneMaskedText, SearchInput, StatusBadge, useApi } from "@/components/ui";
import { useMemo, useState } from "react";

export default function EnviosPage() {
  const { data } = useApi<any[]>("/api/envios", []);
  const [status, setStatus] = useState("");
  const [query, setQuery] = useState("");
  const rows = useMemo(() => data.filter((e) => (!status || e.status === status) && JSON.stringify(e).toLowerCase().includes(query.toLowerCase())), [data, status, query]);
  const formatDate = (value?: string) => value ? new Date(value).toLocaleString() : "-";
  return <AppShell title="Envios" subtitle="Histórico de boas-vindas">
    <div className="mb-4 grid gap-3 md:grid-cols-[1fr_220px]"><SearchInput placeholder="Buscar por nome, telefone, produto ou email" value={query} onChange={(e) => setQuery(e.target.value)} /><select value={status} onChange={(e) => setStatus(e.target.value)} className="focus-ring h-11 rounded-lg border border-line bg-panel px-3"><option value="">Todos</option><option>pendente</option><option>enfileirado</option><option>processando</option><option>sucesso</option><option>erro</option><option>incerto</option></select></div>
    <DataTable columns={["Nome", "Telefone", "Produto", "Status", "Mensagem", "Erro", "ID WhatsApp", "Enviado em", "Tentativas", "Origem", "Criado em"]} rows={rows.map((e) => [e.nome, <PhoneMaskedText key="p" value={e.telefone_mascarado || ""} />, e.produto, <StatusBadge key="s" status={e.status} />, <details key="m"><summary className="cursor-pointer text-muted">Ver</summary><div className="mt-1 max-w-md whitespace-pre-wrap">{e.mensagem_enviada || "-"}</div></details>, <details key="e"><summary className="cursor-pointer text-muted">Ver</summary><div className="mt-1 max-w-md whitespace-pre-wrap">{e.erro || "-"}</div></details>, e.wa_message_id ? <span key="wa" className="font-mono text-xs">{e.wa_message_id}</span> : "-", formatDate(e.sent_at), e.attempts || 0, e.source || "-", formatDate(e.created_at)])} />
  </AppShell>;
}
