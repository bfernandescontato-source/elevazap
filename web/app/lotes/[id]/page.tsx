"use client";

import Link from "next/link";
import { ActionButton, AppShell, DataTable, ErrorState, LoadingState, ProgressBar, StatusBadge, Toast, useApi } from "@/components/ui";
import { ArrowLeft, Pause, Play, X } from "lucide-react";
import { ReactNode, use, useMemo, useState } from "react";

type Tab = "resumo" | "envios" | "nao-confirmados";

export default function LoteDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data: campaigns, loading } = useApi<any[]>("/api/lotes", []);
  const { data: allSends } = useApi<any[]>("/api/envios-grupo", []);
  const { data: senderData } = useApi<{ senders: any[] }>("/api/whatsapp/senders", { senders: [] });
  const [tab, setTab] = useState<Tab>("resumo");
  const [toast, setToast] = useState("");
  const campaign = campaigns.find((item) => item.id === id);
  const sends = useMemo(() => allSends.filter((item) => item.lote_id === id), [allSends, id]);
  const unconfirmed = sends.filter((item) => item.status === "incerto");
  const sender = senderData.senders.find((item) => item.id === campaign?.whatsapp_sender_id);
  const formatDate = (value?: string) => value ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "Não informado";

  async function campaignAction(path: string) {
    const response = await fetch(path, { method: "POST", body: JSON.stringify({ lote_id: id }) });
    if (!response.ok) throw new Error("Não foi possível atualizar a campanha.");
    location.reload();
  }

  async function resolveUnconfirmed(action: "mark-success" | "mark-error" | "retry", id: string) {
    const response = await fetch(`/api/incertos/${action}`, { method: "POST", body: JSON.stringify({ id, kind: "grupo", resolution_note: "Revisado manualmente na campanha." }) });
    if (!response.ok) throw new Error("Não foi possível atualizar o envio.");
    setToast("Envio atualizado.");
    location.reload();
  }

  if (loading) return <AppShell title="Disparo"><LoadingState /></AppShell>;
  if (!campaign) return <AppShell title="Disparo"><ErrorState message="Disparo não encontrado." /></AppShell>;

  const progress = campaign.total ? Math.round(((campaign.enviados || 0) + (campaign.erros || 0)) / campaign.total * 100) : 0;
  const action = <Link href="/lotes" className="inline-flex h-10 items-center gap-2 rounded-lg border border-line bg-white px-3 text-sm font-medium text-ink"><ArrowLeft size={16} />Voltar</Link>;

  return <AppShell title={campaign.titulo || "Disparo"} subtitle={`Criado em ${formatDate(campaign.created_at)}`} action={action}>
    <nav className="mb-5 flex gap-2 overflow-x-auto border-b border-line pb-3" aria-label="Detalhes do disparo">
      <TabButton active={tab === "resumo"} onClick={() => setTab("resumo")}>Visão geral</TabButton>
      <TabButton active={tab === "envios"} onClick={() => setTab("envios")}>Envios</TabButton>
      <TabButton active={tab === "nao-confirmados"} onClick={() => setTab("nao-confirmados")}>Não confirmados ({unconfirmed.length})</TabButton>
    </nav>

    {tab === "resumo" ? <section className="space-y-6">
      <dl className="grid gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-2 lg:grid-cols-4">
        <Info label="Status"><StatusBadge status={campaign.status} /></Info>
        <Info label="Número responsável">{sender?.label || "Número principal"}</Info>
        <Info label="Programada para">{formatDate(campaign.scheduled_at)}</Info>
        <Info label="Grupos">{campaign.total || 0}</Info>
      </dl>
      <div>
        <div className="mb-2 flex justify-between text-sm"><span className="font-medium text-ink">Progresso</span><span className="text-muted">{campaign.enviados || 0} de {campaign.total || 0} enviados</span></div>
        <ProgressBar value={progress} />
      </div>
      <div className="flex flex-wrap gap-2">
        <ActionButton icon={<Pause size={16} />} className="border border-line bg-white text-ink" onClick={() => campaignAction("/api/lotes/pause").catch((error) => setToast(error.message))}>Pausar disparo</ActionButton>
        <ActionButton icon={<Play size={16} />} className="border border-line bg-white text-ink" onClick={() => campaignAction("/api/lotes/resume").catch((error) => setToast(error.message))}>Retomar disparo</ActionButton>
        <ActionButton icon={<X size={16} />} className="border border-red-200 bg-white text-red-700" onClick={() => campaignAction("/api/lotes/cancel-pending").catch((error) => setToast(error.message))}>Cancelar disparo</ActionButton>
      </div>
    </section> : null}

    {tab === "envios" ? <DataTable columns={["Grupo", "Mensagem", "Status", "Erro", "Enviado em"]} rows={sends.map((item) => [
      item.nome_grupo || "—",
      item.texto || item.legenda || item.file_name || "—",
      <StatusBadge key="status" status={item.status} />,
      item.erro || "—",
      formatDate(item.sent_at || item.created_at)
    ])} /> : null}

    {tab === "nao-confirmados" ? <DataTable columns={["Grupo", "Motivo", "Ações"]} rows={unconfirmed.map((item) => [
      item.nome_grupo || "—",
      item.erro || "O WhatsApp não confirmou este envio.",
      <div key="actions" className="flex flex-wrap gap-2">
        <button type="button" onClick={() => resolveUnconfirmed("mark-success", item.id).catch((error) => setToast(error.message))} className="h-9 rounded-lg bg-black px-3 text-xs font-medium text-white">Marcar como enviado</button>
        <button type="button" onClick={() => resolveUnconfirmed("retry", item.id).catch((error) => setToast(error.message))} className="h-9 rounded-lg border border-line px-3 text-xs font-medium">Tentar novamente</button>
        <button type="button" onClick={() => resolveUnconfirmed("mark-error", item.id).catch((error) => setToast(error.message))} className="h-9 rounded-lg border border-red-200 px-3 text-xs font-medium text-red-700">Marcar como falha</button>
      </div>
    ])} /> : null}
    <Toast message={toast} />
  </AppShell>;
}

function TabButton({ active, children, onClick }: { active: boolean; children: ReactNode; onClick: () => void }) {
  return <button type="button" onClick={onClick} className={`h-10 shrink-0 rounded-lg px-4 text-sm font-medium transition ${active ? "bg-black text-white" : "border border-line bg-white text-muted hover:text-ink"}`}>{children}</button>;
}

function Info({ label, children }: { label: string; children: ReactNode }) {
  return <div className="bg-white p-4"><dt className="text-xs text-muted">{label}</dt><dd className="mt-2 text-sm font-medium text-ink">{children}</dd></div>;
}
