"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { AppShell, DataTable, EmptyState, LoadingState } from "@/components/ui";
import { ArrowLeft } from "lucide-react";

type Source = { id: string; name: string; source_key: string; official_flows: { name: string } | null };
type Lead = {
  id: string; created_at: string; full_name: string | null; phone: string | null; status: string;
  error: string | null; flow_run_id: string | null; duplicate_attempts: number;
};

const STATUS_LABELS: Record<string, string> = { pending: "Pendente", accepted: "✅ Aceito", failed: "❌ Falhou" };
const FILTERS = [{ value: "all", label: "Todos" }, { value: "accepted", label: "Aceitos" }, { value: "failed", label: "Falharam" }, { value: "pending", label: "Pendentes" }];

export default function EntradaExternaLeadsPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const [source, setSource] = useState<Source | null>(null);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [filter, setFilter] = useState("all");
  const [loading, setLoading] = useState(true);

  async function load(currentFilter = filter) {
    const response = await fetch(`/api/admin/official/external-sources/${id}/leads?status=${currentFilter}`, { cache: "no-store" });
    const data = await response.json();
    if (response.ok) { setSource(data.source); setLeads(data.leads || []); }
    setLoading(false);
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(filter); }, [filter]);

  if (loading) return <AppShell title="Logs da entrada" subtitle="WhatsApp Oficial"><LoadingState /></AppShell>;
  if (!source) return <AppShell title="Logs da entrada" subtitle="WhatsApp Oficial"><EmptyState title="Entrada não encontrada" description="Volte para entradas externas." /></AppShell>;

  return <AppShell title={source.name} subtitle={`Origem: ${source.source_key} · Fluxo: ${source.official_flows?.name || "—"}`}>
    <div className="space-y-6">
      <Link href="/admin/whatsapp-oficial/entradas-externas" className="inline-flex items-center gap-2 text-sm text-muted hover:text-ink"><ArrowLeft size={15} /> Entradas externas</Link>

      <section>
        <div className="mb-3 flex gap-2">
          {FILTERS.map((item) => <button key={item.value} type="button" onClick={() => setFilter(item.value)} className={`rounded-lg px-3 py-2 text-sm font-medium ${filter === item.value ? "bg-black text-white" : "border border-line bg-white text-ink hover:bg-wash"}`}>{item.label}</button>)}
        </div>

        {!leads.length ? <EmptyState title="Nenhum lead ainda" description="Sem leads para esse filtro." /> : <DataTable
          columns={["Data", "Nome", "Telefone", "Status", "Duplicatas", "Erro", "Flow Run"]}
          rows={leads.map((lead) => [
            new Date(lead.created_at).toLocaleString("pt-BR"),
            lead.full_name || "—",
            lead.phone || "—",
            <span key="status" className={`rounded-full border px-2.5 py-1 text-xs font-medium ${lead.status === "failed" ? "border-red-200 bg-red-50 text-red-700" : lead.status === "accepted" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-line bg-wash text-muted"}`}>{STATUS_LABELS[lead.status] || lead.status}</span>,
            lead.duplicate_attempts > 0 ? String(lead.duplicate_attempts) : "—",
            lead.error || "—",
            lead.flow_run_id ? <span key="run" className="font-mono text-xs">{lead.flow_run_id.slice(0, 8)}</span> : "—"
          ])}
        />}
      </section>
    </div>
  </AppShell>;
}
