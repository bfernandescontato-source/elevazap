"use client";

import Link from "next/link";
import { AppShell, ErrorState, LoadingState } from "@/components/ui";
import { useEffect, useState } from "react";

type DashboardData = {
  connection: { connected: boolean; count: number; phone: string };
  counts: { campaigns: number; groups: number };
  queue: { pendente: number; enfileirado: number; processando: number; sucesso: number; erro: number; incerto: number };
};

export default function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/dashboard/summary", { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "Não foi possível carregar o início.");
        setData(body);
      })
      .catch((currentError) => setError(currentError.message));
  }, []);

  return <DashboardView data={data} error={error} />;
}

function DashboardView({ data, error = "" }: { data: DashboardData | null; error?: string }) {
  const action = <Link href="/campanhas" className="inline-flex h-10 items-center rounded-lg bg-black px-4 text-sm font-medium text-white transition hover:bg-zinc-800">Nova campanha</Link>;

  return <AppShell title="Início" subtitle="Sua operação num olhar só" action={action} hideLogout>
    {error ? <ErrorState message={error} /> : !data ? <LoadingState /> : <div className="space-y-6">
      {data.connection.connected ? <div className="border-l-2 border-emerald-500 pl-3 text-sm font-medium text-emerald-700">
        WhatsApp conectado{data.connection.phone ? ` · ${data.connection.phone}` : ""}
      </div> : <section className="flex flex-col gap-4 rounded-lg border border-red-200 bg-red-50 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div><h2 className="font-semibold text-red-800">WhatsApp desconectado</h2><p className="mt-1 text-sm text-red-700">Suas campanhas estão pausadas até reconectar.</p></div>
        <Link href="/grupos/numeros#numero-principal" className="inline-flex h-10 shrink-0 items-center justify-center rounded-lg bg-red-700 px-4 text-sm font-medium text-white transition hover:bg-red-800">Conectar agora</Link>
      </section>}

      {!data.connection.connected && data.counts.campaigns === 0 ? <Onboarding data={data} /> : <div className="grid gap-4 sm:grid-cols-3">
        <Metric label="Números conectados" value={data.connection.count} />
        <Metric label="Campanhas" value={data.counts.campaigns} />
        <Metric label="Grupos" value={data.counts.groups} />
      </div>}

      <section className="rounded-lg border border-line bg-white p-5">
        <div className="flex items-center justify-between"><h2 className="font-semibold text-ink">Saúde da fila</h2><span className={`text-sm font-medium ${data.queue.erro || data.queue.incerto ? "text-amber-700" : "text-emerald-700"}`}>{data.queue.erro || data.queue.incerto ? "Requer atenção" : "Operação normal"}</span></div>
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-6">
          <QueueMetric label="Pendentes" value={data.queue.pendente + data.queue.enfileirado} />
          <QueueMetric label="Processando" value={data.queue.processando} />
          <QueueMetric label="Sucesso" value={data.queue.sucesso} />
          <QueueMetric label="Erros" value={data.queue.erro} />
          <QueueMetric label="Incertos" value={data.queue.incerto} />
        </div>
      </section>
    </div>}
  </AppShell>;
}

function QueueMetric({ label, value }: { label: string; value: number }) {
  return <div><div className="text-xs text-muted">{label}</div><div className="mt-1 text-xl font-semibold text-ink">{value}</div></div>;
}

function Metric({ label, value }: { label: string; value: number }) {
  return <div className="rounded-lg border border-line bg-white p-5"><div className="text-sm text-muted">{label}</div><div className="mt-2 text-3xl font-semibold text-ink">{value}</div></div>;
}

function Onboarding({ data }: { data: DashboardData }) {
  const steps = [
    { label: "Conectar WhatsApp", href: "/grupos/numeros#numero-principal", done: data.connection.connected },
    { label: "Escolher grupos", href: "/campanhas", done: data.counts.groups > 0 },
    { label: "Criar primeira campanha", href: "/campanhas", done: data.counts.campaigns > 0 }
  ];
  return <ol className="divide-y divide-line rounded-lg border border-line bg-white">
    {steps.map((step, index) => <li key={step.label}><Link href={step.href} className="flex items-center gap-3 px-4 py-4 text-sm font-medium transition hover:bg-wash">
      <span className={`grid h-7 w-7 place-items-center rounded-full border text-xs ${step.done ? "border-emerald-600 bg-emerald-600 text-white" : "border-zinc-300 text-muted"}`}>{step.done ? "✓" : index + 1}</span>
      <span className={step.done ? "text-emerald-700" : "text-ink"}>{step.label}</span>
    </Link></li>)}
  </ol>;
}
