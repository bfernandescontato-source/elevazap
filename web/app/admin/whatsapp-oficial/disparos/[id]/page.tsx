"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ActionButton, AppShell, DataTable, EmptyState, ErrorState, LoadingState, ProgressBar } from "@/components/ui";
import { ArrowLeft, Download, Pause, Play } from "lucide-react";

type Broadcast = {
  id: string; name: string; status: string; total_rows: number; valid_recipients: number;
  processed: number; accepted: number; failed: number; skip_recipients_with_prior_run: boolean;
  created_at: string; started_at: string | null; completed_at: string | null; scheduled_at: string | null;
  official_flows: { name: string } | null;
};
type Recipient = { id: string; phone: string; row_data: { name: string | null }; status: string; meta_message_id: string | null; error: string | null; created_at: string };
type Performance = { sent: number; delivered: number; deliveryRate: number | null; read: number; readRate: number | null; failed: number; steps: Array<{ id: string; name: string; position: number; sent: number; ctas: Array<{ id: string; label: string; ctaKey: string; uniqueClicks: number; totalClicks: number; ctrDelivered: number | null; ctrRead: number | null }> }> };

const STATUS_LABELS: Record<string, string> = { draft: "Rascunho", ready: "Pronto", scheduled: "Agendado", processing: "Em andamento", paused: "Pausado", completed: "Concluído", failed: "Falhou", cancelled: "Cancelado" };

function formatBrasilia(iso: string) {
  return new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" });
}
const FILTERS = [{ value: "all", label: "Todos" }, { value: "accepted", label: "Aceitos" }, { value: "failed", label: "Falharam" }];
const number = new Intl.NumberFormat("pt-BR");
function rate(value: number | null) { return value === null ? "—" : `${value.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`; }
function Metric({ label, value, detail, tone = "" }: { label: string; value: number; detail?: string; tone?: string }) {
  return <div className={`rounded-xl border p-4 ${tone || "border-line bg-white"}`}><p className="text-xs font-medium uppercase tracking-wide text-muted">{label}</p><p className="mt-2 text-2xl font-semibold text-ink">{number.format(value)}</p>{detail ? <p className="mt-1 text-sm text-muted">{detail}</p> : null}</div>;
}

export default function BroadcastDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const [broadcast, setBroadcast] = useState<Broadcast | null>(null);
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [performance, setPerformance] = useState<Performance | null>(null);
  const [filter, setFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [pausing, setPausing] = useState(false);
  const [canceling, setCanceling] = useState(false);
  const [actionError, setActionError] = useState("");
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  async function load(currentFilter = filter) {
    const response = await fetch(`/api/admin/official/broadcasts/${id}?status=${currentFilter}`, { cache: "no-store" });
    const data = await response.json();
    if (response.ok) { setBroadcast(data.broadcast); setRecipients(data.recipients || []); setPerformance(data.performance || null); }
    setLoading(false);
  }

  useEffect(() => { load(filter); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [filter]);

  useEffect(() => {
    if (broadcast?.status === "processing") {
      pollRef.current = setInterval(() => {
        fetch(`/api/admin/official/broadcasts/${id}/nudge`, { method: "POST" }).catch(() => {});
        load(filter);
      }, 2500);
    }
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [broadcast?.status]);

  async function togglePause() {
    if (!broadcast || pausing) return;
    setPausing(true);
    const action = broadcast.status === "processing" ? "pause" : "resume";
    await fetch(`/api/admin/official/broadcasts/${id}/${action}`, { method: "POST" });
    await load(filter);
    setPausing(false);
  }

  async function cancelSchedule() {
    if (!broadcast || canceling) return;
    setCanceling(true);
    setActionError("");
    try {
      const response = await fetch(`/api/admin/official/broadcasts/${id}/cancel`, { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Falha ao cancelar agendamento.");
      await load(filter);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Falha ao cancelar agendamento.");
    } finally {
      setCanceling(false);
    }
  }

  if (loading) return <AppShell title="Disparo" subtitle="WhatsApp Oficial"><LoadingState /></AppShell>;
  if (!broadcast) return <AppShell title="Disparo" subtitle="WhatsApp Oficial"><EmptyState title="Disparo não encontrado" description="Volte para o histórico de disparos." /></AppShell>;

  const progressPercent = broadcast.valid_recipients ? Math.round((broadcast.processed / broadcast.valid_recipients) * 100) : 0;

  return <AppShell title={broadcast.name} subtitle={`Fluxo: ${broadcast.official_flows?.name || "—"}`}>
    <div className="space-y-6">
      <Link href="/admin/whatsapp-oficial/disparos" className="inline-flex items-center gap-2 text-sm text-muted hover:text-ink"><ArrowLeft size={15} /> Disparo 1x1</Link>

      <section className="rounded-lg border border-line bg-panel p-6 shadow-soft">
        {actionError ? <div className="mb-4"><ErrorState message={actionError} /></div> : null}
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="text-sm text-muted">Status</div>
            <div className="mt-1 text-lg font-semibold text-ink">{STATUS_LABELS[broadcast.status] || broadcast.status}</div>
          </div>
          {["processing", "paused"].includes(broadcast.status) ? <ActionButton icon={broadcast.status === "processing" ? <Pause size={16} /> : <Play size={16} />} disabled={pausing} onClick={togglePause} className="border border-line bg-white text-ink hover:bg-wash">{broadcast.status === "processing" ? "Pausar" : "Continuar"}</ActionButton> : null}
          {broadcast.status === "scheduled" ? <ActionButton disabled={canceling} onClick={cancelSchedule} className="border border-line bg-white text-red-700 hover:bg-wash">{canceling ? "Cancelando…" : "Cancelar agendamento"}</ActionButton> : null}
        </div>

        {broadcast.status === "scheduled" && broadcast.scheduled_at
          ? <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-700">Envio programado para {formatBrasilia(broadcast.scheduled_at)} (horário de Brasília).</div>
          : <div className="mt-4">
            <div className="mb-1 flex justify-between text-sm text-muted"><span>{broadcast.processed} / {broadcast.valid_recipients} processados</span><span>{progressPercent}%</span></div>
            <ProgressBar value={progressPercent} />
          </div>}

        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-lg border border-line bg-wash p-3"><div className="text-xs text-muted">Total válidos</div><div className="text-lg font-semibold text-ink">{broadcast.valid_recipients}</div></div>
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3"><div className="text-xs text-emerald-700">Aceitos</div><div className="text-lg font-semibold text-emerald-700">{broadcast.accepted}</div></div>
          <div className="rounded-lg border border-red-200 bg-red-50 p-3"><div className="text-xs text-red-700">Falharam</div><div className="text-lg font-semibold text-red-700">{broadcast.failed}</div></div>
          <div className="rounded-lg border border-line bg-wash p-3"><div className="text-xs text-muted">Ignorar já enviados</div><div className="text-lg font-semibold text-ink">{broadcast.skip_recipients_with_prior_run ? "Sim" : "Não"}</div></div>
        </div>
      </section>

      <section className="rounded-2xl border border-line bg-panel p-6">
        <div className="flex flex-wrap items-end justify-between gap-3"><div><h2 className="text-lg font-semibold text-ink">Resultado do disparo</h2><p className="mt-1 text-sm text-muted">Acompanhe a jornada a partir da primeira mensagem, como no painel de transmissões.</p></div><span className="rounded-full bg-wash px-3 py-1 text-xs text-muted">Atualiza com os eventos da Meta</span></div>
        {performance ? <>
          <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Metric label="Enviadas" value={performance.sent} />
            <Metric label="Entregues" value={performance.delivered} detail={rate(performance.deliveryRate)} tone="border-emerald-200 bg-emerald-50" />
            <Metric label="Lidas" value={performance.read} detail={`${rate(performance.readRate)} das entregues`} tone="border-sky-200 bg-sky-50" />
            <Metric label="Falharam" value={performance.failed} tone={performance.failed ? "border-red-200 bg-red-50" : "border-line bg-white"} />
          </div>
          {performance.steps.some((step) => step.ctas.length) ? <div className="mt-6 grid gap-4 lg:grid-cols-2">{performance.steps.filter((step) => step.ctas.length).map((step) => <article key={step.id} className="rounded-xl border border-line bg-white p-5"><div className="flex items-start justify-between gap-3"><div><p className="text-xs font-medium uppercase tracking-wide text-muted">Etapa {step.position}</p><h3 className="mt-1 font-semibold text-ink">{step.name}</h3></div><span className="rounded-full bg-wash px-3 py-1 text-xs text-muted">{number.format(step.sent)} enviadas</span></div><div className="mt-4 space-y-3">{step.ctas.map((cta) => <div key={cta.id} className="rounded-lg bg-wash p-3"><div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1"><p className="font-medium text-ink">{cta.label}</p><p className="text-sm text-muted">CTR: {rate(cta.ctrDelivered)}</p></div><p className="mt-1 text-sm text-muted"><strong className="font-semibold text-ink">{number.format(cta.uniqueClicks)}</strong> pessoas clicaram · {number.format(cta.totalClicks)} cliques no total{cta.ctrRead !== null ? ` · ${rate(cta.ctrRead)} das pessoas que leram` : ""}</p></div>)}</div></article>)}</div> : <p className="mt-5 rounded-xl bg-wash p-4 text-sm text-muted">Este disparo não tem botões rastreáveis configurados no fluxo.</p>}
        </> : <p className="mt-5 rounded-xl bg-wash p-4 text-sm text-muted">As métricas aparecerão quando as mensagens forem atribuídas ao disparo.</p>}
      </section>

      <section>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex gap-2">
            {FILTERS.map((item) => <button key={item.value} type="button" onClick={() => setFilter(item.value)} className={`rounded-lg px-3 py-2 text-sm font-medium ${filter === item.value ? "bg-black text-white" : "border border-line bg-white text-ink hover:bg-wash"}`}>{item.label}</button>)}
          </div>
          <a href={`/api/admin/official/broadcasts/${id}/export-failures`} className="inline-flex h-10 items-center gap-2 rounded-lg border border-line bg-white px-3 text-sm font-medium text-ink hover:bg-wash"><Download size={15} /> Baixar falhas CSV</a>
        </div>

        {!recipients.length ? <EmptyState title="Nenhum contato" description="Sem contatos para esse filtro ainda." /> : <DataTable
          columns={["Telefone", "Nome", "Status", "Meta Message ID", "Erro"]}
          rows={recipients.map((recipient) => [
            recipient.phone,
            recipient.row_data?.name || "—",
            <span key="status" className={`rounded-full border px-2.5 py-1 text-xs font-medium ${recipient.status === "failed" ? "border-red-200 bg-red-50 text-red-700" : recipient.status === "accepted" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-line bg-wash text-muted"}`}>{recipient.status}</span>,
            recipient.meta_message_id || "—",
            recipient.error || "—"
          ])}
        />}
      </section>
    </div>
  </AppShell>;
}
