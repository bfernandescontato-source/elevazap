"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ActionButton, AppShell, DataTable, EmptyState, LoadingState, ProgressBar } from "@/components/ui";
import { ArrowLeft, Download, Pause, Play } from "lucide-react";

type Broadcast = {
  id: string; name: string; status: string; total_rows: number; valid_recipients: number;
  processed: number; accepted: number; failed: number; skip_recipients_with_prior_run: boolean;
  created_at: string; started_at: string | null; completed_at: string | null;
  official_flows: { name: string } | null;
};
type Recipient = { id: string; phone: string; row_data: { name: string | null }; status: string; meta_message_id: string | null; error: string | null; created_at: string };

const STATUS_LABELS: Record<string, string> = { draft: "Rascunho", ready: "Pronto", processing: "Em andamento", paused: "Pausado", completed: "Concluído", failed: "Falhou" };
const FILTERS = [{ value: "all", label: "Todos" }, { value: "accepted", label: "Aceitos" }, { value: "failed", label: "Falharam" }];

export default function BroadcastDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const [broadcast, setBroadcast] = useState<Broadcast | null>(null);
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [filter, setFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [pausing, setPausing] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  async function load(currentFilter = filter) {
    const response = await fetch(`/api/admin/official/broadcasts/${id}?status=${currentFilter}`, { cache: "no-store" });
    const data = await response.json();
    if (response.ok) { setBroadcast(data.broadcast); setRecipients(data.recipients || []); }
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

  if (loading) return <AppShell title="Disparo" subtitle="WhatsApp Oficial"><LoadingState /></AppShell>;
  if (!broadcast) return <AppShell title="Disparo" subtitle="WhatsApp Oficial"><EmptyState title="Disparo não encontrado" description="Volte para o histórico de disparos." /></AppShell>;

  const progressPercent = broadcast.valid_recipients ? Math.round((broadcast.processed / broadcast.valid_recipients) * 100) : 0;

  return <AppShell title={broadcast.name} subtitle={`Fluxo: ${broadcast.official_flows?.name || "—"}`}>
    <div className="space-y-6">
      <Link href="/admin/whatsapp-oficial/disparos" className="inline-flex items-center gap-2 text-sm text-muted hover:text-ink"><ArrowLeft size={15} /> Disparo 1x1</Link>

      <section className="rounded-lg border border-line bg-panel p-6 shadow-soft">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="text-sm text-muted">Status</div>
            <div className="mt-1 text-lg font-semibold text-ink">{STATUS_LABELS[broadcast.status] || broadcast.status}</div>
          </div>
          {["processing", "paused"].includes(broadcast.status) ? <ActionButton icon={broadcast.status === "processing" ? <Pause size={16} /> : <Play size={16} />} disabled={pausing} onClick={togglePause} className="border border-line bg-white text-ink hover:bg-wash">{broadcast.status === "processing" ? "Pausar" : "Continuar"}</ActionButton> : null}
        </div>

        <div className="mt-4">
          <div className="mb-1 flex justify-between text-sm text-muted"><span>{broadcast.processed} / {broadcast.valid_recipients} processados</span><span>{progressPercent}%</span></div>
          <ProgressBar value={progressPercent} />
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-lg border border-line bg-wash p-3"><div className="text-xs text-muted">Total válidos</div><div className="text-lg font-semibold text-ink">{broadcast.valid_recipients}</div></div>
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3"><div className="text-xs text-emerald-700">Aceitos</div><div className="text-lg font-semibold text-emerald-700">{broadcast.accepted}</div></div>
          <div className="rounded-lg border border-red-200 bg-red-50 p-3"><div className="text-xs text-red-700">Falharam</div><div className="text-lg font-semibold text-red-700">{broadcast.failed}</div></div>
          <div className="rounded-lg border border-line bg-wash p-3"><div className="text-xs text-muted">Ignorar já enviados</div><div className="text-lg font-semibold text-ink">{broadcast.skip_recipients_with_prior_run ? "Sim" : "Não"}</div></div>
        </div>
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
