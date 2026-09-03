"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AlertTriangle, CheckCircle2, RefreshCw, XCircle } from "lucide-react";
import { AppShell, ActionButton, ConfirmModal, ErrorState, LoadingState, Toast } from "@/components/ui";

type Status = {
  status: "disconnected" | "connecting" | "connected" | "reauthorization_required" | "error";
  connectedByEmail: string | null;
  connectedAt: string | null;
  lastRefreshedAt: string | null;
  accessTokenExpiresAt: string | null;
  lastError: string | null;
};
type CatalogStatus = { totalProducts: number; lastSync: null | { started_at: string; finished_at: string | null; total_received: number; inserted_count: number; updated_count: number; error_count: number; status: string; duration_ms: number | null; error_message: string | null } };

const ERROR_MESSAGES: Record<string, string> = {
  not_admin: "Sessão de administrador inválida. Faça login novamente e tente conectar de novo.",
  invalid_state: "A autorização expirou ou é inválida. Tente conectar novamente.",
  exchange_failed: "Não foi possível concluir a autorização com o Mercado Livre. Tente novamente."
};

const STATUS_LABELS: Record<Status["status"], string> = {
  disconnected: "Desconectado",
  connecting: "Conectando",
  connected: "Conectado",
  reauthorization_required: "Precisa reautorizar",
  error: "Erro"
};

export default function MercadoLivreCatalogAdminPage() {
  return <Suspense fallback={<AppShell title="Mercado Livre — Catálogo"><LoadingState /></AppShell>}>
    <MercadoLivreCatalogAdminContent />
  </Suspense>;
}

function MercadoLivreCatalogAdminContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [data, setData] = useState<Status | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [notice, setNotice] = useState("");
  const [catalog, setCatalog] = useState<CatalogStatus | null>(null);
  const [syncing, setSyncing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const response = await fetch("/api/admin/mercado-livre-catalog/status", { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Não foi possível carregar o status.");
      setData(body);
      const catalogResponse = await fetch("/api/admin/mercado-livre-catalog/catalog", { cache: "no-store" });
      const catalogBody = await catalogResponse.json();
      if (!catalogResponse.ok) throw new Error(catalogBody.error || "Não foi possível carregar o catálogo.");
      setCatalog(catalogBody);
    } catch (current) {
      setError(current instanceof Error ? current.message : "Não foi possível carregar o status.");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    const errorCode = searchParams.get("error");
    const connected = searchParams.get("connected");
    if (errorCode) setNotice(ERROR_MESSAGES[errorCode] || "Não foi possível conectar ao Mercado Livre.");
    else if (connected) setNotice("Mercado Livre conectado com sucesso.");
    if (errorCode || connected) router.replace("/admin/mercado-livre-catalog");
  }, [searchParams, router]);

  const disconnect = async () => {
    setDisconnecting(true);
    try {
      await fetch("/api/admin/mercado-livre-catalog/disconnect", { method: "POST" });
      setNotice("Mercado Livre desconectado.");
      await load();
    } finally { setDisconnecting(false); setConfirmOpen(false); }
  };
  const sync = async () => {
    setSyncing(true); setNotice("");
    try {
      const response = await fetch("/api/admin/mercado-livre-catalog/sync", { method: "POST" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || body.error_message || "Não foi possível sincronizar o catálogo.");
      setNotice(body.message || `Catálogo sincronizado: ${body.inserted} novos, ${body.updated} atualizados.`); await load();
    } catch (current) { setNotice(current instanceof Error ? current.message : "Não foi possível sincronizar o catálogo."); }
    finally { setSyncing(false); }
  };

  const statusIcon = data?.status === "connected" ? <CheckCircle2 className="text-emerald-600" size={22} />
    : data?.status === "reauthorization_required" || data?.status === "error" ? <AlertTriangle className="text-amber-600" size={22} />
    : <XCircle className="text-muted" size={22} />;

  return <AppShell title="Mercado Livre — Catálogo" subtitle="Integração central e única, administrada pela Disparei, usada pelo Catálogo para buscar produtos do Mercado Livre.">
    <div className="mx-auto max-w-2xl space-y-4">
      {notice ? <Toast message={notice} /> : null}
      {loading ? <LoadingState /> : error ? <ErrorState message={error} /> : <>
      {catalog ? <div className="rounded-lg border border-line bg-panel p-5 shadow-soft"><div className="flex flex-wrap items-center justify-between gap-3"><div><div className="font-semibold text-ink">Catálogo importado</div><div className="text-sm text-muted">Produtos da fonte externa salvos localmente.</div></div><div className="flex gap-2"><ActionButton icon={<RefreshCw className={syncing ? "animate-spin" : ""} size={15} />} disabled={syncing} className="bg-black text-white hover:bg-zinc-800" onClick={sync}>{catalog.totalProducts ? "Atualizar catálogo" : "Importar catálogo"}</ActionButton></div></div><div className="mt-5 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4"><Metric label="Produtos" value={String(catalog.totalProducts)} /><Metric label="Novos" value={String(catalog.lastSync?.inserted_count ?? 0)} /><Metric label="Atualizados" value={String(catalog.lastSync?.updated_count ?? 0)} /><Metric label="Erros" value={String(catalog.lastSync?.error_count ?? 0)} /></div><div className="mt-4 text-sm text-muted">Última sincronização: {formatDate(catalog.lastSync?.finished_at || catalog.lastSync?.started_at || null)}{catalog.lastSync?.error_message ? ` · ${catalog.lastSync.error_message}` : ""}</div></div> : null}
      {data ? <div className="rounded-lg border border-line bg-panel p-5 shadow-soft">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {statusIcon}
            <div>
              <div className="font-semibold text-ink">{STATUS_LABELS[data.status]}</div>
              {data.connectedByEmail ? <div className="text-sm text-muted">Conectado por {data.connectedByEmail}</div> : null}
            </div>
          </div>
          <ActionButton icon={<RefreshCw size={15} />} className="border border-line bg-white text-ink hover:bg-wash" onClick={() => load()}>Atualizar</ActionButton>
        </div>

        <div className="mt-5 space-y-2 border-t border-line pt-4 text-sm">
          <Row label="Conectado em" value={formatDate(data.connectedAt)} />
          <Row label="Última renovação" value={formatDate(data.lastRefreshedAt)} />
          <Row label="Token expira em" value={formatDate(data.accessTokenExpiresAt)} />
          {data.lastError ? <Row label="Último erro" value={data.lastError} /> : null}
        </div>

        <div className="mt-5 flex gap-2">
          <a href="/api/admin/mercado-livre-catalog/authorize" className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-black px-4 text-sm font-medium text-white hover:bg-zinc-800">
            {data.status === "connected" ? "Reconectar ao Mercado Livre" : "Conectar ao Mercado Livre"}
          </a>
          {data.status !== "disconnected" ? <ActionButton className="border border-line bg-white text-red-600 hover:bg-red-50" onClick={() => setConfirmOpen(true)}>Desconectar</ActionButton> : null}
        </div>
      </div> : null}</>}
    </div>

    <ConfirmModal open={confirmOpen} title="Desconectar Mercado Livre" confirmLabel="Desconectar" destructive loading={disconnecting}
      onCancel={() => setConfirmOpen(false)} onConfirm={disconnect}>
      O Catálogo vai parar de mostrar produtos do Mercado Livre até que a integração seja reconectada.
    </ConfirmModal>
  </AppShell>;
}

function Metric({ label, value }: { label: string; value: string }) { return <div className="rounded-lg bg-wash p-3"><div className="text-xs text-muted">{label}</div><div className="mt-1 font-semibold text-ink">{value}</div></div>; }

function Row({ label, value }: { label: string; value: string }) {
  return <div className="flex items-center justify-between"><span className="text-muted">{label}</span><span className="text-ink">{value}</span></div>;
}

function formatDate(value: string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleString("pt-BR");
}
