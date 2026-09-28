"use client";

import Link from "next/link";
import { AppShell, ErrorState, LoadingState } from "@/components/ui";
import { useEffect, useState, type ReactNode } from "react";
import { BarChart3, Check, ChevronRight, Hourglass, Megaphone, Phone, Plus, RefreshCw, Users, X } from "lucide-react";

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

// Tudo com "terra:" (ou escondido com "hidden terra:…") só aparece no tema terra;
// o visual clássico continua exatamente como antes.
function DashboardView({ data, error = "" }: { data: DashboardData | null; error?: string }) {
  const action = <Link href="/campanhas" className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-white transition hover:bg-primary-hover terra:bg-coral terra:shadow-[0_8px_18px_-8px_rgb(var(--c-coral)/0.8)] terra:hover:bg-coral/90"><Plus size={16} className="hidden terra:block"/>Nova campanha</Link>;
  const attention = Boolean(data && (data.queue.erro || data.queue.incerto));

  return <AppShell title="Início" subtitle="Sua operação num olhar só" greeting action={action} hideLogout>
    {error ? <ErrorState message={error} /> : !data ? <LoadingState /> : <div className="space-y-6 terra:space-y-5">
      {data.connection.connected ? <div className="border-l-2 border-emerald-500 pl-3 text-sm font-medium text-emerald-700 terra:flex terra:items-center terra:gap-3 terra:rounded-xl terra:border terra:border-emerald-200/70 terra:bg-emerald-100/60 terra:px-4 terra:py-2.5">
        <WhatsAppGlyph className="hidden h-7 w-7 shrink-0 terra:block"/>
        <span className="terra:flex-1 terra:text-ink">WhatsApp conectado{data.connection.phone ? ` · ${data.connection.phone}` : ""}</span>
        <span className="hidden items-center gap-1.5 rounded-full bg-white px-3 py-1 text-xs font-semibold text-ink shadow-sm terra:inline-flex"><span className="h-2 w-2 rounded-full bg-emerald-500"/>Conectado</span>
      </div> : <section className="flex flex-col gap-4 rounded-lg border border-red-200 bg-red-50 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div><h2 className="font-semibold text-red-800">WhatsApp desconectado</h2><p className="mt-1 text-sm text-red-700">Suas campanhas estão pausadas até reconectar.</p></div>
        <Link href="/grupos/numeros" className="inline-flex h-10 shrink-0 items-center justify-center rounded-lg bg-red-700 px-4 text-sm font-medium text-white transition hover:bg-red-800">Conectar agora</Link>
      </section>}

      {!data.connection.connected && data.counts.campaigns === 0 ? <Onboarding data={data} /> : <div className="grid gap-4 sm:grid-cols-3 terra:grid-cols-3 terra:gap-2.5 terra:sm:gap-4">
        <Metric label="Números conectados" value={data.connection.count} icon={<Phone size={24} fill="currentColor" strokeWidth={1.5}/>} tone="olive" />
        <Metric label="Campanhas" value={data.counts.campaigns} icon={<Megaphone size={24} fill="currentColor" strokeWidth={1.5}/>} tone="coral" />
        <Metric label="Grupos" value={data.counts.groups} icon={<Users size={24} fill="currentColor" strokeWidth={1.5}/>} tone="lilac" />
      </div>}

      <section className="rounded-lg border border-line bg-white p-5 terra:rounded-2xl">
        <div className="flex items-center justify-between"><h2 className="font-semibold text-ink">Saúde da fila</h2>
          <span className={`text-sm font-medium ${attention ? "text-amber-700" : "text-emerald-700"} terra:hidden`}>{attention ? "Requer atenção" : "Operação normal"}</span>
          {attention ? <Link href="/incidentes" className="hidden items-center gap-1 text-sm font-semibold text-ink hover:text-primary terra:inline-flex">Requer atenção <ChevronRight size={16}/></Link> : <span className="hidden text-sm font-semibold text-emerald-700 terra:inline">Operação normal</span>}
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-6 terra:gap-y-4 terra:sm:grid-cols-5 terra:sm:gap-0 terra:sm:divide-x terra:sm:divide-line">
          <QueueMetric label="Pendentes" value={data.queue.pendente + data.queue.enfileirado} icon={<Hourglass size={20} strokeWidth={2.2}/>} tone="text-amber-500" />
          <QueueMetric label="Processando" value={data.queue.processando} icon={<RefreshCw size={20} strokeWidth={2.2}/>} tone="text-teal-600" />
          <QueueMetric label="Sucesso" value={data.queue.sucesso} icon={<Check size={22} strokeWidth={3}/>} tone="text-emerald-500" />
          <QueueMetric label="Erros" value={data.queue.erro} icon={<X size={22} strokeWidth={3}/>} tone="text-red-500" />
          <QueueMetric label="Incertos" value={data.queue.incerto} icon={<span className="text-lg font-bold leading-none">?</span>} tone="text-lilac" />
        </div>
      </section>

      <StatusCard healthy={data.connection.connected && !data.queue.erro} />
    </div>}
  </AppShell>;
}

function QueueMetric({ label, value, icon, tone }: { label: string; value: number; icon: ReactNode; tone: string }) {
  return <div className="terra:flex terra:items-start terra:gap-3 terra:sm:px-5 terra:sm:first:pl-0">
    <span className={`mt-1 hidden h-6 w-6 shrink-0 place-items-center terra:grid ${tone}`}>{icon}</span>
    <div><div className="text-xs text-muted">{label}</div><div className="mt-1 text-xl font-semibold text-ink terra:text-2xl">{value}</div></div>
  </div>;
}

const metricTones = {
  olive: "terra:border-emerald-200/60 terra:bg-emerald-100/60 [&_.metric-icon]:bg-emerald-200/70 [&_.metric-icon]:text-emerald-600",
  coral: "terra:border-orange-200/60 terra:bg-orange-100/60 [&_.metric-icon]:bg-orange-200/70 [&_.metric-icon]:text-orange-500",
  lilac: "terra:border-lilac/15 terra:bg-lilac-soft [&_.metric-icon]:bg-lilac/20 [&_.metric-icon]:text-lilac"
};
function Metric({ label, value, icon, tone }: { label: string; value: number; icon: ReactNode; tone: keyof typeof metricTones }) {
  return <div className={`rounded-lg border border-line bg-white p-5 terra:flex terra:flex-col terra:items-start terra:gap-2 terra:rounded-2xl terra:p-3 terra:sm:flex-row terra:sm:items-center terra:sm:gap-4 terra:sm:px-6 terra:sm:py-5 ${metricTones[tone]}`}>
    <span className="metric-icon hidden h-10 w-10 shrink-0 place-items-center rounded-full terra:grid sm:h-14 sm:w-14">{icon}</span>
    <div className="min-w-0"><div className="text-sm text-muted terra:text-xs terra:text-ink/80 terra:sm:text-sm">{label}</div><div className="mt-2 text-3xl font-semibold text-ink terra:mt-1 terra:text-2xl terra:sm:text-3xl">{value}</div></div>
  </div>;
}

// Balão verde com telefone, no estilo do ícone do WhatsApp.
function WhatsAppGlyph({ className }: { className?: string }) {
  return <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
    <path d="M16 3C8.8 3 3 8.6 3 15.6c0 2.5.8 4.9 2.1 6.9L3.6 28.4l6.1-1.6c1.9 1 4 1.6 6.3 1.6 7.2 0 13-5.6 13-12.6S23.2 3 16 3Z" fill="rgb(var(--c-emerald-500))"/>
    <path d="M12.2 9.6c-.3-.6-.6-.6-.9-.6h-.8c-.3 0-.7.1-1 .5-.4.4-1.4 1.3-1.4 3.2s1.4 3.7 1.6 4c.2.3 2.7 4.2 6.6 5.8 3.2 1.3 3.9 1 4.6.9.7-.1 2.3-.9 2.6-1.9.3-.9.3-1.7.2-1.9-.1-.2-.4-.3-.8-.5l-2.7-1.3c-.4-.1-.6-.2-.9.2-.3.4-1 1.3-1.3 1.5-.2.3-.5.3-.9.1-.4-.2-1.6-.6-3.1-1.9-1.1-1-1.9-2.3-2.1-2.7-.2-.4 0-.6.2-.8l.6-.7c.2-.2.3-.4.4-.7.1-.3.1-.5 0-.7l-1.2-3Z" fill="#fff"/>
  </svg>;
}

// Card de resumo embaixo (só no tema terra): "Tudo funcionando bem!" com o
// WhatsApp conectado e sem erros; senão, aviso com link para Incidentes.
function StatusCard({ healthy }: { healthy: boolean }) {
  return <Link href={healthy ? "/campanhas" : "/incidentes"} className={`relative hidden min-h-28 items-center gap-5 overflow-hidden rounded-2xl border px-6 py-5 transition hover:shadow-soft terra:flex ${healthy ? "border-line bg-panel" : "border-amber-200 bg-amber-50"}`}>
    <span className={`shrink-0 ${healthy ? "text-primary" : "text-amber-600"}`}><BarChart3 size={34} strokeWidth={2.6}/></span>
    <div className="relative z-10 min-w-0 flex-1"><h2 className="font-semibold text-ink">{healthy ? "Tudo funcionando bem!" : "Alguns envios precisam de atenção"}</h2><p className="mt-1 text-sm text-muted">{healthy ? "Continue criando campanhas para aumentar seus resultados." : "Veja os incidentes para saber o que fazer."}</p></div>
    {healthy ? <GrowthArt/> : null}
  </Link>;
}

function GrowthArt() {
  return <svg viewBox="0 0 190 100" className="pointer-events-none absolute -bottom-1 right-0 hidden h-28 w-52 sm:block" aria-hidden="true">
    <path d="M40 100 C 48 62, 96 52, 128 58 C 160 64, 178 40, 190 34 L 190 100 Z" fill="rgb(var(--c-orange-100))"/>
    <rect x="96" y="70" width="16" height="30" rx="3" fill="rgb(var(--c-teal-500))"/>
    <rect x="120" y="54" width="16" height="46" rx="3" fill="rgb(var(--c-teal-500))"/>
    <rect x="144" y="34" width="16" height="66" rx="3" fill="rgb(var(--c-teal-600))"/>
    <path d="M86 70 C 104 62, 122 50, 136 34 S 152 14, 160 8" fill="none" stroke="rgb(var(--c-teal-600))" strokeWidth="3.2" strokeLinecap="round"/>
    <path d="M150 7 L161 6 L160 17" fill="none" stroke="rgb(var(--c-teal-600))" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M70 64 l9 5 M66 78 l11 1 M74 50 l7 8" stroke="rgb(var(--c-coral))" strokeWidth="3.2" strokeLinecap="round"/>
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
