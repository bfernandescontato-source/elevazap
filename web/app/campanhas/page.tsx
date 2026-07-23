"use client";

import Link from "next/link";
import { AppShell, DataTable, LoadingState, PhoneMaskedText, ProgressBar, SearchInput, StatusBadge, useApi } from "@/components/ui";
import { Plus } from "lucide-react";
import { ReactNode, useEffect, useMemo, useState } from "react";

type Tab = "campanhas" | "individuais" | "grupos";

export default function CampanhasPage() {
  const { data: campaigns, loading } = useApi<any[]>("/api/lotes", []);
  const { data: individualSends } = useApi<any[]>("/api/envios", []);
  const { data: groupSends } = useApi<any[]>("/api/envios-grupo", []);
  const [tab, setTab] = useState<Tab>("campanhas");
  const [query, setQuery] = useState("");

  useEffect(() => {
    const selectedTab = new URLSearchParams(window.location.search).get("tab");
    if (selectedTab === "individuais" || selectedTab === "grupos") setTab(selectedTab);
  }, []);

  const campaignNames = useMemo(() => new Map(campaigns.map((campaign) => [campaign.id, campaign.titulo])), [campaigns]);
  const filteredIndividual = useMemo(() => individualSends.filter((item) => JSON.stringify(item).toLowerCase().includes(query.toLowerCase())), [individualSends, query]);
  const filteredGroups = useMemo(() => groupSends.filter((item) => JSON.stringify(item).toLowerCase().includes(query.toLowerCase())), [groupSends, query]);
  const formatDate = (value?: string) => value ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(value)) : "—";

  const action = <Link href="/grupos?tab=disparo" className="inline-flex h-10 items-center gap-2 rounded-lg bg-black px-4 text-sm font-medium text-white transition hover:bg-zinc-800"><Plus size={16} />Nova campanha</Link>;

  return <AppShell title="Campanhas" subtitle="Acompanhe seus disparos em um só lugar" action={action}>
    <nav className="mb-5 flex gap-2 overflow-x-auto border-b border-line pb-3" aria-label="Conteúdo de campanhas">
      <TabButton active={tab === "campanhas"} onClick={() => setTab("campanhas")}>Campanhas</TabButton>
      <TabButton active={tab === "individuais"} onClick={() => setTab("individuais")}>Envios individuais</TabButton>
      <TabButton active={tab === "grupos"} onClick={() => setTab("grupos")}>Envios em grupo</TabButton>
    </nav>

    {tab === "campanhas" ? loading ? <LoadingState /> : <DataTable
      columns={["Nome", "Status", "Progresso", "Programada para", "Criada em", "Ação"]}
      rows={campaigns.map((campaign) => {
        const progress = campaign.total ? Math.round(((campaign.enviados || 0) + (campaign.erros || 0)) / campaign.total * 100) : 0;
        return [
          <span key="name" className="font-medium text-ink">{campaign.titulo || "Campanha sem nome"}</span>,
          <StatusBadge key="status" status={campaign.status} />,
          <div key="progress" className="min-w-40"><ProgressBar value={progress} /><div className="mt-1 text-xs text-muted">{campaign.enviados || 0} de {campaign.total || 0} enviados</div></div>,
          formatDate(campaign.scheduled_at),
          formatDate(campaign.created_at),
          <Link key="open" href={`/campanhas/${campaign.id}`} className="text-sm font-medium text-ink underline underline-offset-4">Abrir campanha</Link>
        ];
      })}
    /> : null}

    {tab === "individuais" ? <section className="space-y-4">
      <SearchInput placeholder="Buscar por nome, telefone, produto ou e-mail" value={query} onChange={(event) => setQuery(event.target.value)} />
      <DataTable columns={["Nome", "Telefone", "Produto", "Status", "Mensagem", "Data"]} rows={filteredIndividual.map((item) => [
        item.nome || "—",
        <PhoneMaskedText key="phone" value={item.telefone_mascarado || ""} />,
        item.produto || "—",
        <StatusBadge key="status" status={item.status} />,
        item.mensagem_enviada || "—",
        formatDate(item.created_at)
      ])} />
    </section> : null}

    {tab === "grupos" ? <section className="space-y-4">
      <SearchInput placeholder="Buscar por campanha, grupo ou status" value={query} onChange={(event) => setQuery(event.target.value)} />
      <DataTable columns={["Campanha", "Grupo", "Mensagem", "Status", "Data"]} rows={filteredGroups.map((item) => [
        campaignNames.get(item.lote_id) || "Campanha",
        item.nome_grupo || "—",
        item.texto || item.legenda || item.file_name || "—",
        <StatusBadge key="status" status={item.status} />,
        formatDate(item.created_at)
      ])} />
    </section> : null}
  </AppShell>;
}

function TabButton({ active, children, onClick }: { active: boolean; children: ReactNode; onClick: () => void }) {
  return <button type="button" onClick={onClick} className={`h-10 shrink-0 rounded-lg px-4 text-sm font-medium transition ${active ? "bg-black text-white" : "border border-line bg-white text-muted hover:text-ink"}`}>{children}</button>;
}
