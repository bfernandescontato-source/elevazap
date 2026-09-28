"use client";

import Link from "next/link";
import { AppShell, ErrorState, LoadingState } from "@/components/ui";
import { useEffect, useState, type ReactNode } from "react";
import { BarChart3, CheckCircle2, Clock3, Hourglass, Megaphone, MessageCircle, Plus, RefreshCw, Smartphone, Users, XCircle } from "lucide-react";

type DashboardData = {
  connection: { connected: boolean; count: number; phone: string };
  counts: { campaigns: number; groups: number };
  queue: { pendente: number; enfileirado: number; processando: number; sucesso: number; erro: number; incerto: number };
};

// Ao voltar para o Início, mostra na hora o último resumo e atualiza por trás.
let lastSummary: DashboardData | null = null;

export default function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(lastSummary);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/dashboard/summary", { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "Não foi possível carregar o início.");
        lastSummary = body;
        setData(body);
      })
      .catch((currentError) => { if (!lastSummary) setError(currentError.message); });
  }, []);

  return <DashboardView data={data} error={error} />;
}

function DashboardView({ data, error = "" }: { data: DashboardData | null; error?: string }) {
  const action = <Link href="/campanhas" className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-white transition hover:bg-primary-hover terra:bg-coral terra:shadow-[0_8px_18px_-8px_rgb(var(--c-coral)/0.8)] terra:hover:bg-coral/90"><Plus size={16} className="hidden terra:block"/>Nova campanha</Link>;

  return <AppShell title="Início" subtitle="Sua operação num olhar só" greeting="Sua operação muito mais fácil." action={action} hideLogout>
    {error ? <ErrorState message={error} /> : !data ? <LoadingState /> : <div className="space-y-6">
      {data.connection.connected ? <div className="border-l-2 border-emerald-500 pl-3 text-sm font-medium text-emerald-700 terra:flex terra:items-center terra:gap-3 terra:rounded-2xl terra:border terra:border-emerald-100 terra:bg-emerald-50 terra:px-4 terra:py-3">
        <span className="hidden h-8 w-8 shrink-0 place-items-center rounded-full bg-emerald-500 text-white terra:grid"><MessageCircle size={17}/></span>
        <span className="terra:flex-1">WhatsApp conectado{data.connection.phone ? ` · ${data.connection.phone}` : ""}</span>
        <span className="hidden items-center gap-1.5 rounded-full bg-white px-3 py-1 text-xs font-semibold text-emerald-700 shadow-sm terra:inline-flex"><span className="h-2 w-2 rounded-full bg-emerald-500"/>Conectado</span>
      </div> : <section className="flex flex-col gap-4 rounded-lg border border-red-200 bg-red-50 p-4 terra:rounded-2xl sm:flex-row sm:items-center sm:justify-between">
        <div><h2 className="font-semibold text-red-800">WhatsApp desconectado</h2><p className="mt-1 text-sm text-red-700">Suas campanhas estão pausadas até reconectar.</p></div>
        <Link href="/grupos/numeros" className="inline-flex h-10 shrink-0 items-center justify-center rounded-lg bg-red-700 px-4 text-sm font-medium text-white transition hover:bg-red-800">Conectar agora</Link>
      </section>}

      {!data.connection.connected && data.counts.campaigns === 0 ? <Onboarding data={data} /> : <div className="grid gap-4 sm:grid-cols-3 terra:grid-cols-3 terra:gap-2.5 terra:sm:gap-4">
        <Metric label="Números conectados" value={data.connection.count} icon={<Smartphone size={22}/>} tone="olive" />
        <Metric label="Campanhas" value={data.counts.campaigns} icon={<Megaphone size={22}/>} tone="coral" />
        <Metric label="Grupos" value={data.counts.groups} icon={<Users size={22}/>} tone="teal" />
      </div>}

      <section className="rounded-lg border border-line bg-white p-5 terra:rounded-2xl terra:shadow-soft">
        <div className="flex items-center justify-between"><h2 className="font-semibold text-ink">Saúde da fila</h2><span className={`text-sm font-medium ${data.queue.erro || data.queue.incerto ? "text-amber-700" : "text-emerald-700"}`}>{data.queue.erro || data.queue.incerto ? "Requer atenção" : "Operação normal"}</span></div>
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-6 terra:sm:grid-cols-5">
          <QueueMetric label="Pendentes" value={data.queue.pendente + data.queue.enfileirado} icon={<Hourglass size={18}/>} tone="text-amber-600" />
          <QueueMetric label="Processando" value={data.queue.processando} icon={<RefreshCw size={18}/>} tone="text-teal-600" />
          <QueueMetric label="Sucesso" value={data.queue.sucesso} icon={<CheckCircle2 size={18}/>} tone="text-emerald-600" />
          <QueueMetric label="Erros" value={data.queue.erro} icon={<XCircle size={18}/>} tone="text-red-600" />
          <QueueMetric label="Incertos" value={data.queue.incerto} icon={<Clock3 size={18}/>} tone="text-amber-600" />
        </div>
      </section>

      <StatusCard healthy={data.connection.connected && !data.queue.erro && !data.queue.incerto} />
    </div>}
  </AppShell>;
}

// Ícones, caixinhas e tons só aparecem no tema terra.
function QueueMetric({ label, value, icon, tone }: { label: string; value: number; icon: ReactNode; tone: string }) {
  return <div className="terra:flex terra:items-start terra:gap-2.5 terra:rounded-xl terra:border terra:border-line terra:bg-panel terra:p-3">
    <span className={`mt-0.5 hidden terra:block ${tone}`}>{icon}</span>
    <div><div className="text-xs text-muted">{label}</div><div className="mt-1 text-xl font-semibold text-ink terra:text-2xl">{value}</div></div>
  </div>;
}

const metricTones = {
  olive: "terra:border-emerald-200/70 terra:bg-emerald-100/70 [&_.metric-icon]:bg-emerald-200/80 [&_.metric-icon]:text-emerald-700",
  coral: "terra:border-orange-200/70 terra:bg-orange-100/70 [&_.metric-icon]:bg-orange-200/80 [&_.metric-icon]:text-orange-700",
  teal: "terra:border-teal-200/70 terra:bg-teal-100/70 [&_.metric-icon]:bg-teal-200/80 [&_.metric-icon]:text-teal-700"
};
function Metric({ label, value, icon, tone }: { label: string; value: number; icon: ReactNode; tone: keyof typeof metricTones }) {
  return <div className={`rounded-lg border border-line bg-white p-5 terra:flex terra:flex-col terra:items-start terra:gap-2 terra:rounded-2xl terra:p-3 terra:sm:flex-row terra:sm:items-center terra:sm:gap-4 terra:sm:p-5 ${metricTones[tone]}`}>
    <span className="metric-icon hidden h-10 w-10 shrink-0 place-items-center rounded-full terra:grid sm:h-14 sm:w-14">{icon}</span>
    <div className="min-w-0"><div className="text-sm text-muted terra:text-xs terra:sm:text-sm">{label}</div><div className="mt-2 text-3xl font-semibold text-ink terra:mt-1 terra:text-2xl terra:sm:text-3xl">{value}</div></div>
  </div>;
}

// Resumo do estado geral (só no tema terra).
function StatusCard({ healthy }: { healthy: boolean }) {
  return <Link href={healthy ? "/campanhas" : "/incidentes"} className={`relative hidden items-center gap-4 overflow-hidden rounded-2xl border p-5 transition hover:shadow-soft terra:flex ${healthy ? "border-line bg-panel" : "border-amber-200 bg-amber-50"}`}>
    <span className={`grid h-12 w-12 shrink-0 place-items-center rounded-xl ${healthy ? "bg-teal-50 text-primary" : "bg-amber-100 text-amber-700"}`}><BarChart3 size={26}/></span>
    <div className="min-w-0 flex-1"><h2 className="font-semibold text-ink">{healthy ? "Tudo funcionando bem!" : "Alguns envios precisam de atenção"}</h2><p className="mt-1 text-sm text-muted">{healthy ? "Continue criando campanhas para aumentar seus resultados." : "Veja os incidentes para saber o que fazer."}</p></div>
    {healthy ? <GrowthArt/> : null}
  </Link>;
}

function GrowthArt() {
  return <svg viewBox="0 0 150 72" className="hidden h-16 w-36 shrink-0 sm:block" aria-hidden="true">
    <ellipse cx="96" cy="60" rx="58" ry="22" fill="rgb(var(--c-orange-50))"/>
    <rect x="70" y="44" width="14" height="22" rx="2" fill="rgb(var(--c-emerald-500))"/>
    <rect x="92" y="32" width="14" height="34" rx="2" fill="rgb(var(--c-emerald-500))"/>
    <rect x="114" y="18" width="14" height="48" rx="2" fill="rgb(var(--c-emerald-600))"/>
    <path d="M58 50 L82 34 L100 40 L134 8" fill="none" stroke="rgb(var(--c-teal-600))" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M124 7 L135 7 L135 18" fill="none" stroke="rgb(var(--c-teal-600))" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M40 30 l8 6 M36 44 l10 1 M44 18 l6 9" stroke="rgb(var(--c-coral))" strokeWidth="3" strokeLinecap="round"/>
  </svg>;
}

function Onboarding({ data }: { data: DashboardData }) {
  const steps = [
    { label: "Conectar WhatsApp", href: "/grupos/numeros", done: data.connection.connected },
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
