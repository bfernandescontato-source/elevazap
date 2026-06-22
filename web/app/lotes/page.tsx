"use client";

import { ActionButton, AppShell, DataTable, ProgressBar, StatusBadge, useApi, Icons } from "@/components/ui";

export default function LotesPage() {
  const { data, loading } = useApi<any[]>("/api/lotes", []);
  async function action(path: string, id: string) { await fetch(path, { method: "POST", body: JSON.stringify({ lote_id: id }) }); location.reload(); }
  return <AppShell title="Lotes" subtitle="Progresso, agendamento e controle manual">
    {loading ? null : <DataTable columns={["Título", "Status", "Progresso", "Agendado", "Início", "Conclusão", "Ações"]} rows={data.map((l) => {
      const progress = l.total ? Math.round(((l.enviados || 0) + (l.erros || 0)) / l.total * 100) : 0;
      return [l.titulo, <StatusBadge key="s" status={l.status} />, <div key="p" className="min-w-40"><ProgressBar value={progress} /><div className="mt-1 text-xs text-muted">{l.enviados || 0}/{l.total || 0} enviados</div></div>, l.scheduled_at ? new Date(l.scheduled_at).toLocaleString() : "-", l.started_at ? new Date(l.started_at).toLocaleString() : "-", l.finished_at ? new Date(l.finished_at).toLocaleString() : "-", <div key="a" className="flex gap-2"><ActionButton title="Pausar" icon={<Icons.Pause size={15} />} className="border border-line bg-panel text-ink" onClick={() => action("/api/lotes/pause", l.id)} /><ActionButton title="Retomar" icon={<Icons.Play size={15} />} className="border border-line bg-panel text-ink" onClick={() => action("/api/lotes/resume", l.id)} /><ActionButton title="Cancelar pendentes" className="bg-coral text-white" onClick={() => action("/api/lotes/cancel-pending", l.id)}>Cancelar</ActionButton></div>];
    })} />}
  </AppShell>;
}
