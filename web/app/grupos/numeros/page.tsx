"use client";

import { ActionButton, AppShell, ConfirmModal, EmptyState, LoadingState, StatusBadge, Toast } from "@/components/ui";
import { AlertTriangle, Phone, Plus, QrCode, RefreshCw, Trash2, Unplug } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import Image from "next/image";

type Sender = {
  id: string;
  label: string;
  session_name: string;
  status?: string;
  qr?: string;
  phone_number?: string;
  display_name?: string;
  created_at?: string;
};

type PlanUsage = {
  senders: number;
  maxSenders: number;
  unlimitedSenders: boolean;
};

async function responseData(response: Response) {
  const text = await response.text();
  if (!text) return {} as Record<string, any>;
  try { return JSON.parse(text); }
  catch { return {} as Record<string, any>; }
}

export default function NumerosPage() {
  const [senders, setSenders] = useState<Sender[]>([]);
  const [usage, setUsage] = useState<PlanUsage | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionId, setActionId] = useState("");
  const [label, setLabel] = useState("");
  const [toast, setToast] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<Sender | null>(null);
  const loadingRef = useRef(false);

  async function load() {
    if (loadingRef.current) return;
    loadingRef.current = true;
    try {
      const [sendersRes, accountRes] = await Promise.all([
        fetch("/api/whatsapp/senders", { cache: "no-store" }),
        fetch("/api/account", { cache: "no-store" }),
      ]);
      const [sendersData, accountData] = await Promise.all([responseData(sendersRes), responseData(accountRes)]);
      if (!sendersRes.ok) throw new Error(sendersData.error || "Falha ao carregar números.");
      setSenders(sendersData.senders || []);
      if (accountData.limits) {
        setUsage({
          senders: accountData.usage?.senders ?? 0,
          maxSenders: accountData.limits.maxSenders,
          unlimitedSenders: accountData.limits.unlimitedSenders ?? false,
        });
      }
    } finally {
      loadingRef.current = false;
    }
  }

  useEffect(() => {
    load().catch((error) => setToast(error.message)).finally(() => setLoading(false));
    const timer = window.setInterval(() => load().catch(() => undefined), 6000);
    return () => window.clearInterval(timer);
  }, []);

  async function createSender() {
    setActionId("new");
    try {
      const response = await fetch("/api/whatsapp/senders", { method: "POST", body: JSON.stringify({ label }) });
      const data = await responseData(response);
      if (!response.ok) throw new Error(data.error || "Falha ao criar número.");
      setLabel("");
      if (data.sender) setSenders((current) => [...current.filter((item) => item.id !== data.sender.id), data.sender]);
      setToast(data.sender?.qr ? "QR Code pronto. Escaneie com o WhatsApp." : "Número criado. Aguardando o QR Code...");
      await load();
    } catch (error) {
      await load().catch(() => undefined);
      throw error;
    } finally {
      setActionId("");
    }
  }

  async function runAction(sender: Sender, action: "connect" | "disconnect" | "refresh-groups") {
    setActionId(`${sender.id}:${action}`);
    try {
      const response = await fetch(`/api/whatsapp/senders/${sender.id}/${action}`, { method: "POST" });
      const data = await responseData(response);
      if (!response.ok) throw new Error(data.error || `Falha ao atualizar número (${response.status}).`);
      if (action === "connect" && data.status === "connected") setToast("Este número já está conectado.");
      else setToast(action === "refresh-groups" ? "Grupos atualizados." : action === "disconnect" ? "Número desconectado." : data.qr ? "QR Code pronto. Escaneie com o WhatsApp." : "Conexão iniciada. Aguardando o QR Code...");
      await load();
    } finally {
      setActionId("");
    }
  }

  async function deleteSender() {
    if (!deleteTarget) return;
    setActionId(`${deleteTarget.id}:delete`);
    try {
      const response = await fetch(`/api/whatsapp/senders/${deleteTarget.id}`, { method: "DELETE" });
      const data = await responseData(response);
      if (!response.ok) throw new Error(data.error || "Falha ao excluir número.");
      setDeleteTarget(null);
      setToast("Número excluído da conta.");
      await load();
    } catch (error: any) {
      setToast(error.message);
    } finally {
      setActionId("");
    }
  }

  const fail = (error: any) => setToast(error?.message || "Algo deu errado.");
  const formatDate = (value?: string) => value ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "Não disponível";

  const atLimit = usage !== null && !usage.unlimitedSenders && (usage.senders >= usage.maxSenders);
  const usageLabel = usage
    ? usage.unlimitedSenders
      ? `${usage.senders} número(s) conectado(s)`
      : `${usage.senders} de ${usage.maxSenders} número(s) do plano`
    : null;

  return <AppShell title="Números conectados" subtitle="Gerencie os telefones usados nos disparos do Disparei">

    {/* Contador de uso do plano */}
    {usage && (
      <div className={`mb-4 flex items-center gap-3 rounded-lg border px-4 py-3 text-sm ${atLimit ? "border-amber-200 bg-amber-50 text-amber-800" : "border-line bg-panel text-muted"}`}>
        {atLimit && <AlertTriangle size={16} className="shrink-0 text-amber-600" />}
        <span>{usageLabel}</span>
        {atLimit && (
          <span className="ml-auto font-medium text-amber-800">
            Limite atingido — remova um número ou faça upgrade do plano para continuar.
          </span>
        )}
      </div>
    )}

    <section className="mb-6 rounded-lg border border-line bg-panel p-5 shadow-soft">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end">
        <div className="flex-1">
          <label className="text-sm font-medium text-ink">Identificação do número</label>
          <input
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            placeholder="Ex: Comercial ou Campanha semanal"
            disabled={atLimit}
            className="focus-ring mt-1 h-11 w-full rounded-lg border border-line px-3 text-sm disabled:bg-wash disabled:text-muted"
          />
        </div>
        <ActionButton
          icon={<Plus size={16} />}
          disabled={!label.trim() || actionId === "new" || atLimit}
          onClick={() => createSender().catch(fail)}
        >
          {actionId === "new" ? "Criando..." : "Conectar novo número"}
        </ActionButton>
      </div>
      {atLimit && (
        <p className="mt-3 text-sm text-amber-700">
          Você atingiu o limite de números do seu plano. Para adicionar mais, remova um número existente ou faça upgrade.
        </p>
      )}
    </section>

    {loading ? <LoadingState /> : <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
      {senders.map((sender) => {
        const busy = actionId.startsWith(sender.id);
        return <article key={sender.id} className="rounded-lg border border-line bg-panel p-5 shadow-soft">
          <div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="flex items-center gap-2 font-semibold text-ink"><Phone size={17} /> <span className="truncate">{sender.label}</span></div><div className="mt-1 text-sm text-muted">{sender.phone_number || "Número aguardando conexão"}</div></div><StatusBadge status={sender.status} /></div>
          <dl className="mt-5 grid gap-3 border-y border-line py-4 text-sm"><div className="flex justify-between gap-4"><dt className="text-muted">Nome no WhatsApp</dt><dd className="text-right font-medium">{sender.display_name || "Não disponível"}</dd></div><div className="flex justify-between gap-4"><dt className="text-muted">Adicionado em</dt><dd className="text-right">{formatDate(sender.created_at)}</dd></div><div className="flex justify-between gap-4"><dt className="text-muted">Identificador</dt><dd className="max-w-48 truncate font-mono text-xs" title={sender.session_name}>{sender.session_name}</dd></div></dl>
          {sender.qr ? <div className="mt-4"><p className="mb-3 text-center text-sm text-muted">Escaneie com o WhatsApp deste número</p><div className="flex justify-center rounded-lg bg-wash p-4"><Image src={sender.qr} alt={`QR Code de ${sender.label}`} width={224} height={224} unoptimized className="h-56 w-56 rounded-lg bg-white p-2" /></div></div> : null}
          <div className="mt-4 flex flex-wrap gap-2">
            <ActionButton icon={<QrCode size={15} />} disabled={busy} className="border border-line bg-white text-ink" onClick={() => runAction(sender, "connect").catch(fail)}>Gerar QR</ActionButton>
            <ActionButton icon={<RefreshCw size={15} />} disabled={busy || sender.status !== "connected"} className="border border-line bg-white text-ink" onClick={() => runAction(sender, "refresh-groups").catch(fail)}>Atualizar grupos</ActionButton>
            <ActionButton icon={<Unplug size={15} />} disabled={busy || sender.status !== "connected"} className="border border-line bg-white text-ink" onClick={() => runAction(sender, "disconnect").catch(fail)}>Desconectar</ActionButton>
            <button type="button" title="Excluir número" disabled={busy} onClick={() => setDeleteTarget(sender)} className="ml-auto grid h-10 w-10 place-items-center rounded-lg border border-red-200 text-red-600 transition hover:bg-red-50 disabled:opacity-40"><Trash2 size={16} /></button>
          </div>
        </article>;
      })}
      {!senders.length ? <div className="lg:col-span-2 2xl:col-span-3"><EmptyState title="Nenhum número conectado" description="Informe uma identificação acima para conectar seu primeiro WhatsApp." /></div> : null}
    </div>}

    <ConfirmModal open={Boolean(deleteTarget)} title="Excluir número?" onCancel={() => setDeleteTarget(null)} onConfirm={deleteSender} confirmLabel="Excluir número" loading={actionId.endsWith(":delete")} destructive>
      Tem certeza de que deseja excluir este número? Ele será desconectado, removido das campanhas e os disparos ainda pendentes serão cancelados. O histórico dos envios já realizados será preservado.
    </ConfirmModal>
    <Toast message={toast} />
  </AppShell>;
}
