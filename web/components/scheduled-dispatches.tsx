"use client";

import { EmptyState, LoadingState, StatusBadge } from "@/components/ui";
import { RefreshCw } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

type Batch = {
  id: string;
  titulo?: string | null;
  campanha_id?: string | null;
  status?: string | null;
  scheduled_at?: string | null;
  created_at?: string | null;
};

type GroupDispatch = {
  id: string;
  lote_id: string;
  group_jid: string;
  nome_grupo?: string | null;
  status?: string | null;
  scheduled_at?: string | null;
  created_at?: string | null;
};

type Campaign = { id: string; nome: string };

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
  const [dispatches, setDispatches] = useState<GroupDispatch[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const loadingRef = useRef(false);

  async function load() {
    if (loadingRef.current) return;
    loadingRef.current = true;
    try {
      const [batchResponse, dispatchResponse, campaignResponse] = await Promise.all([
        fetch("/api/lotes", { cache: "no-store" }),
        fetch("/api/envios-grupo", { cache: "no-store" }),
        fetch("/api/campanhas", { cache: "no-store" })
      ]);
      const [batchData, dispatchData, campaignData] = await Promise.all([
        batchResponse.json(), dispatchResponse.json(), campaignResponse.json()
      ]);
      if (!batchResponse.ok || !dispatchResponse.ok || !campaignResponse.ok) {
        throw new Error(batchData.error || dispatchData.error || campaignData.error || "Falha ao carregar os disparos programados.");
      }
      setBatches(Array.isArray(batchData) ? batchData : []);
      setDispatches(Array.isArray(dispatchData) ? dispatchData : []);
      setCampaigns(Array.isArray(campaignData) ? campaignData : []);
      setError("");
    } catch (currentError: any) {
      setError(currentError?.message || "Falha ao carregar os disparos programados.");
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    const timer = window.setInterval(load, 10000);
    return () => window.clearInterval(timer);
  }, []);

  const rows = useMemo(() => {
    const batchMap = new Map(batches.map((batch) => [batch.id, batch]));
    const campaignMap = new Map(campaigns.map((campaign) => [campaign.id, campaign.nome]));
    return dispatches
      .map((dispatch) => {
        const batch = batchMap.get(dispatch.lote_id);
        if (!batch) return null;
        return {
          ...dispatch,
          campaign: campaignMap.get(batch.campanha_id || "") || batch.titulo || "Campanha não informada",
          scheduledAt: dispatch.scheduled_at || batch.scheduled_at,
          scheduledDisplay: scheduledParts(dispatch.scheduled_at || batch.scheduled_at),
          programmedAt: batch.created_at || dispatch.created_at,
          visibleStatus: visibleStatus(dispatch.status, dispatch.scheduled_at || batch.scheduled_at)
        };
      })
      .filter(Boolean)
      .sort((a, b) => new Date(b?.scheduledAt || 0).getTime() - new Date(a?.scheduledAt || 0).getTime());
  }, [batches, campaigns, dispatches]);

  if (loading) return <LoadingState />;

  return <section>
    <div className="mb-4 flex items-center justify-between gap-4">
      <div>
        <h2 className="font-semibold text-ink">Disparos programados</h2>
        <p className="mt-1 text-sm text-muted">Acompanhe a data e o horário de Brasília de cada envio.</p>
      </div>
      <button type="button" onClick={() => { setLoading(true); load(); }} className="inline-flex h-10 shrink-0 items-center gap-2 rounded-lg border border-line bg-white px-3 text-sm font-medium text-ink hover:bg-wash">
        <RefreshCw size={16} /> Atualizar
      </button>
    </div>

    {error ? <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div> : null}
    {!rows.length ? <EmptyState title="Nenhum disparo programado" description="Os disparos criados aparecerão aqui com seus horários e status." /> : <div className="overflow-hidden rounded-lg border border-line bg-white shadow-soft">
      <div className="hidden grid-cols-[minmax(160px,1.2fr)_minmax(180px,1.4fr)_minmax(130px,0.8fr)_minmax(160px,1fr)_minmax(160px,1fr)] gap-4 border-b border-line bg-wash px-5 py-3 text-xs font-medium uppercase text-muted lg:grid">
        <div>Campanha</div><div>Grupo</div><div>Status</div><div>Data e horário do disparo</div><div>Programado em</div>
      </div>
      <div className="divide-y divide-line">
        {rows.map((row) => row ? <article key={row.id} className="grid gap-4 px-5 py-4 lg:grid-cols-[minmax(160px,1.2fr)_minmax(180px,1.4fr)_minmax(130px,0.8fr)_minmax(160px,1fr)_minmax(160px,1fr)] lg:items-center">
          <div><div className="text-xs text-muted lg:hidden">Campanha</div><div className="mt-1 font-medium text-ink lg:mt-0">{row.campaign}</div></div>
          <div className="min-w-0"><div className="text-xs text-muted lg:hidden">Grupo</div><div className="mt-1 truncate text-sm text-ink lg:mt-0">{row.nome_grupo || row.group_jid}</div></div>
          <div><div className="mb-1 text-xs text-muted lg:hidden">Status</div><StatusBadge status={row.visibleStatus} /></div>
          <div><div className="text-xs text-muted lg:hidden">Data e horário do disparo</div><div className="mt-1 text-sm font-medium text-ink lg:mt-0">{row.scheduledDisplay.date}</div><div className="mt-0.5 text-sm text-muted">às {row.scheduledDisplay.time}</div></div>
          <div><div className="text-xs text-muted lg:hidden">Programado em</div><div className="mt-1 text-sm text-muted lg:mt-0">{formatDate(row.programmedAt)}</div></div>
        </article> : null)}
      </div>
    </div>}
  </section>;
}
