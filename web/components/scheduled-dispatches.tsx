"use client";

import { EmptyState, LoadingState, StatusBadge } from "@/components/ui";
import { RefreshCw, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

type Batch = {
  id: string;
  titulo?: string | null;
  campanha_id?: string | null;
  status?: string | null;
  scheduled_at?: string | null;
  created_at?: string | null;
  total?: number | null;
  pendentes?: number | null;
  modelos_mensagem?: { id: string; nome: string } | null;
};

type Campaign = { id: string; nome: string };

const FINAL_STATUSES = new Set(["sucesso", "erro", "cancelado"]);

function formatDate(value?: string | null) {
  if (!value) return "Não informado";
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "America/Sao_Paulo"
  }).format(new Date(value));
}

function scheduledParts(value?: string | null) {
  if (!value) return { date: "Não informada", time: "Não informado" };
  const current = new Date(value);
  return {
    date: new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeZone: "America/Sao_Paulo" }).format(current),
    time: new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" }).format(current)
  };
}

function visibleStatus(status?: string | null, scheduledAt?: string | null) {
  if (["sucesso", "erro", "cancelado", "incerto", "processando"].includes(status || "")) return status || "pendente";
  if (scheduledAt && new Date(scheduledAt).getTime() > Date.now()) return "programado";
  return status || "pendente";
}

export function ScheduledDispatches() {
  const [batches, setBatches] = useState<Batch[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [cancelling, setCancelling] = useState<string | null>(null);
  const loadingRef = useRef(false);

  async function load() {
    if (loadingRef.current) return;
    loadingRef.current = true;
    try {
      const [batchResponse, campaignResponse] = await Promise.all([
        fetch("/api/lotes", { cache: "no-store" }),
        fetch("/api/campanhas", { cache: "no-store" })
      ]);
      const [batchData, campaignData] = await Promise.all([
        batchResponse.json(), campaignResponse.json()
      ]);
      if (!batchResponse.ok || !campaignResponse.ok) {
        throw new Error(batchData.error || campaignData.error || "Falha ao carregar os disparos programados.");
      }
      setBatches(Array.isArray(batchData) ? batchData : []);
      setCampaigns(Array.isArray(campaignData) ? campaignData : []);
      setError("");
    } catch (currentError: any) {
      setError(currentError?.message || "Falha ao carregar os disparos programados.");
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  }

  async function cancelLote(loteId: string) {
    setCancelling(loteId);
    try {
      const r = await fetch("/api/lotes/cancel-pending", {
        method: "POST",
        body: JSON.stringify({ lote_id: loteId })
      });
      if (!r.ok) {
        const d = await r.json();
        throw new Error(d.error || "Falha ao cancelar.");
      }
      await load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setCancelling(null);
    }
  }

  useEffect(() => {
    load();
    const timer = window.setInterval(load, 10000);
    return () => window.clearInterval(timer);
  }, []);

  const rows = useMemo(() => {
    const campaignMap = new Map(campaigns.map((c) => [c.id, c.nome]));
    return batches
      .map((batch) => {
        const vs = visibleStatus(batch.status, batch.scheduled_at);
        return {
          id: batch.id,
          campaign: campaignMap.get(batch.campanha_id || "") || batch.titulo || "Campanha não informada",
          modeloNome: batch.modelos_mensagem?.nome || batch.titulo || null,
          grupos: batch.total ?? 1,
          scheduledAt: batch.scheduled_at,
          scheduledDisplay: scheduledParts(batch.scheduled_at),
          programmedAt: batch.created_at,
          visibleStatus: vs,
          canCancel: !FINAL_STATUSES.has(vs)
        };
      })
      .filter((row) => !FINAL_STATUSES.has(row.visibleStatus))
      .sort((a, b) => new Date(a.scheduledAt || 0).getTime() - new Date(b.scheduledAt || 0).getTime());
  }, [batches, campaigns]);

  if (loading) return <LoadingState />;

  return <section>
    <div className="mb-4 flex items-center justify-between gap-4">
      <div>
        <h2 className="font-semibold text-ink">Disparos programados</h2>
        <p className="mt-1 text-sm text-muted">Somente os pendentes de envio. Ordenado por horário de disparo.</p>
      </div>
      <button type="button" onClick={() => { setLoading(true); load(); }} className="inline-flex h-10 shrink-0 items-center gap-2 rounded-lg border border-line bg-white px-3 text-sm font-medium text-ink hover:bg-wash">
        <RefreshCw size={16} /> Atualizar
      </button>
    </div>

    {error ? <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div> : null}
    {!rows.length
      ? <EmptyState title="Nenhum disparo pendente" description="Quando criar agendamentos eles aparecerão aqui. Disparos já enviados não são exibidos." />
      : <div className="overflow-hidden rounded-lg border border-line bg-white shadow-soft">
          <div className="hidden grid-cols-[minmax(160px,1.2fr)_minmax(180px,1.4fr)_minmax(80px,0.5fr)_minmax(130px,0.8fr)_minmax(160px,1fr)_40px] gap-4 border-b border-line bg-wash px-5 py-3 text-xs font-medium uppercase text-muted lg:grid">
            <div>Campanha</div><div>Mensagem</div><div>Grupos</div><div>Status</div><div>Data e horário do disparo</div><div />
          </div>
          <div className="divide-y divide-line">
            {rows.map((row) => (
              <article key={row.id} className="grid gap-4 px-5 py-4 lg:grid-cols-[minmax(160px,1.2fr)_minmax(180px,1.4fr)_minmax(80px,0.5fr)_minmax(130px,0.8fr)_minmax(160px,1fr)_40px] lg:items-center">
                <div><div className="text-xs text-muted lg:hidden">Campanha</div><div className="mt-1 font-medium text-ink lg:mt-0">{row.campaign}</div></div>
                <div className="min-w-0"><div className="text-xs text-muted lg:hidden">Mensagem</div><div className="mt-1 truncate text-sm text-ink lg:mt-0">{row.modeloNome || "—"}</div></div>
                <div><div className="text-xs text-muted lg:hidden">Grupos</div><div className="mt-1 text-sm text-ink lg:mt-0">{row.grupos}</div></div>
                <div><div className="mb-1 text-xs text-muted lg:hidden">Status</div><StatusBadge status={row.visibleStatus} /></div>
                <div><div className="text-xs text-muted lg:hidden">Data e horário</div><div className="mt-1 text-sm font-medium text-ink lg:mt-0">{row.scheduledDisplay.date}</div><div className="mt-0.5 text-sm text-muted">às {row.scheduledDisplay.time}</div></div>
                <div className="flex justify-end">
                  {row.canCancel && (
                    <button
                      type="button"
                      disabled={cancelling === row.id}
                      onClick={() => cancelLote(row.id)}
                      title="Cancelar agendamento"
                      className="grid h-8 w-8 place-items-center rounded-lg text-muted hover:bg-red-50 hover:text-red-600 disabled:opacity-40"
                    >
                      <X size={15} />
                    </button>
                  )}
                </div>
              </article>
            ))}
          </div>
        </div>
    }
  </section>;
}
