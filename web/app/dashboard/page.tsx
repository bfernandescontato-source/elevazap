"use client";

import { AlertCard, AppShell, DataTable, ErrorState, LoadingState, StatCard, StatusBadge } from "@/components/ui";
import { Inbox, Send, Users } from "lucide-react";
import { useEffect, useState } from "react";

export default function DashboardPage() {
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState("");
  useEffect(() => { fetch("/api/dashboard/summary").then((r) => r.json()).then(setData).catch((e) => setError(e.message)); }, []);
  return (
    <AppShell title="Dashboard" subtitle="Saúde da operação, fila e últimos eventos">
      {error ? <ErrorState message={error} /> : !data ? <LoadingState /> : <div className="space-y-6">
        {data.service?.status !== "connected" ? <AlertCard title="WhatsApp desconectado">Conecte o número para liberar novos envios.</AlertCard> : null}
        {data.counts?.welcome_uncertain > 0 ? <AlertCard tone="critical" title="Boas-vindas incertas">{data.counts.welcome_uncertain} item(ns) precisam de decisão manual.</AlertCard> : null}
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <StatCard label="WhatsApp" value={<StatusBadge status={data.service?.status} />} icon={<Send size={18} />} />
          <StatCard label="Pendentes" value={data.counts?.pending || 0} />
          <StatCard label="Incertos" value={data.counts?.uncertain || 0} icon={<Inbox size={18} />} />
          <StatCard label="Grupos" value={data.counts?.groups || 0} icon={<Users size={18} />} />
          <StatCard label="Enfileirados" value={data.counts?.queued || 0} />
          <StatCard label="Processando" value={data.counts?.processing || 0} />
          <StatCard label="Erros" value={data.counts?.errors || 0} />
          <StatCard label="Enviados hoje" value={data.counts?.sent_today || 0} />
        </div>
        <div className="grid gap-6 xl:grid-cols-2">
          <section><h2 className="mb-3 font-semibold">Últimos envios</h2><DataTable columns={["Nome", "Produto", "Status"]} rows={(data.latestEnvios || []).map((e: any) => [e.nome, e.produto, <StatusBadge key={e.id} status={e.status} />])} /></section>
          <section><h2 className="mb-3 font-semibold">Últimos lotes</h2><DataTable columns={["Título", "Status", "Total"]} rows={(data.latestLotes || []).map((l: any) => [l.titulo, <StatusBadge key={l.id} status={l.status} />, l.total])} /></section>
        </div>
      </div>}
    </AppShell>
  );
}
