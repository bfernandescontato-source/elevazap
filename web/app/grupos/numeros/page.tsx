"use client";

import { ActionButton, AppShell, ConfirmModal, EmptyState, LoadingState, StatusBadge, Toast } from "@/components/ui";
import { Phone, Plus, QrCode, RefreshCw, Trash2, Unplug } from "lucide-react";
import { useEffect, useRef, useState } from "react";

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

type PrincipalStatus = {
  status?: string;
  qr?: string;
  phone_number?: string;
  display_name?: string;
};

async function responseData(response: Response) {
  const text = await response.text();
  if (!text) return {} as Record<string, any>;
  try { return JSON.parse(text); }
  catch { return {} as Record<string, any>; }
}

export default function NumerosPage() {
  const [senders, setSenders] = useState<Sender[]>([]);
  const [principal, setPrincipal] = useState<PrincipalStatus>({});
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
    const [response, statusResponse, qrResponse] = await Promise.all([
      fetch("/api/whatsapp/senders", { cache: "no-store" }),
      fetch("/api/whatsapp/status", { cache: "no-store" }),
      fetch("/api/whatsapp/qr", { cache: "no-store" })
    ]);
    const [data, status, qr] = await Promise.all([responseData(response), responseData(statusResponse), responseData(qrResponse)]);
    if (!response.ok) throw new Error(data.error || "Falha ao carregar números.");
    setSenders(data.senders || []);
    setPrincipal({ ...status, qr: qr.qr || "" });
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

  async function principalAction(action: "restart" | "logout" | "refresh") {
    setActionId(`principal:${action}`);
    try {
      const route = action === "restart" ? "/api/whatsapp/restart" : action === "logout" ? "/api/whatsapp/logout" : "/api/whatsapp/groups/refresh";
      const response = await fetch(route, { method: "POST" });
      const data = await responseData(response);
      const fallbackError = action === "restart" ? `Falha ao gerar o QR Code (${response.status}). Tente novamente em alguns segundos.` : action === "logout" ? `Falha ao desconectar o número (${response.status}).` : `Falha ao atualizar os grupos (${response.status}).`;
      if (!response.ok) throw new Error(data.error || fallbackError);
      if (action === "restart" && data.qr) setPrincipal((current) => ({ ...current, ...data }));
      setToast(action === "restart" ? data.qr ? "QR Code pronto. Escaneie com o WhatsApp." : "Novo QR Code solicitado. Aguarde alguns segundos." : action === "logout" ? "Número principal desconectado." : "Grupos atualizados.");
      window.setTimeout(() => load().catch(() => undefined), 800);
    } finally {
      setActionId("");
    }
  }

  const fail = (error: any) => setToast(error?.message || "Algo deu errado.");
  const formatDate = (value?: string) => value ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "Não disponível";

  return <AppShell title="Números conectados" subtitle="Gerencie os telefones usados nos disparos do Disparei">
    <section className="mb-6 rounded-lg border border-line bg-panel p-5 shadow-soft">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end">
        <div className="flex-1"><label className="text-sm font-medium text-ink">Identificação do número</label><input value={label} onChange={(event) => setLabel(event.target.value)} placeholder="Ex: Comercial ou Campanha semanal" className="focus-ring mt-1 h-11 w-full rounded-lg border border-line px-3 text-sm" /></div>
        <ActionButton icon={<Plus size={16} />} disabled={!label.trim() || actionId === "new"} onClick={() => createSender().catch(fail)}>{actionId === "new" ? "Criando..." : "Conectar novo número"}</ActionButton>
      </div>
    </section>

    {loading ? <LoadingState /> : <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
      <article id="numero-principal" className="scroll-mt-28 rounded-lg border border-zinc-400 bg-panel p-5 shadow-soft">
        <div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="flex items-center gap-2 font-semibold text-ink"><Phone size={17} /> <span className="truncate">Número principal</span></div><div className="mt-1 text-sm text-muted">{principal.phone_number || "Número aguardando conexão"}</div></div><StatusBadge status={principal.status} /></div>
        <dl className="mt-5 grid gap-3 border-y border-line py-4 text-sm"><div className="flex justify-between gap-4"><dt className="text-muted">Nome no WhatsApp</dt><dd className="text-right font-medium">{principal.display_name || "Não disponível"}</dd></div><div className="flex justify-between gap-4"><dt className="text-muted">Uso</dt><dd className="text-right">Padrão para envios sem número selecionado</dd></div></dl>
        {principal.qr ? <div className="mt-4"><p className="mb-3 text-center text-sm text-muted">Escaneie com o WhatsApp deste número</p><div className="flex justify-center rounded-lg bg-wash p-4"><img src={principal.qr} alt="QR Code do número principal" className="h-56 w-56 rounded-lg bg-white p-2" /></div></div> : null}
        <div className="mt-4 flex flex-wrap gap-2"><ActionButton icon={<QrCode size={15} />} disabled={actionId.startsWith("principal") || principal.status === "connected"} className="border border-line bg-white text-ink" onClick={() => principalAction("restart").catch(fail)}>{actionId === "principal:restart" ? "Gerando QR..." : "Gerar QR"}</ActionButton><ActionButton icon={<RefreshCw size={15} />} disabled={actionId.startsWith("principal") || principal.status !== "connected"} className="border border-line bg-white text-ink" onClick={() => principalAction("refresh").catch(fail)}>Atualizar grupos</ActionButton><ActionButton icon={<Unplug size={15} />} disabled={actionId.startsWith("principal") || principal.status !== "connected"} className="border border-line bg-white text-ink" onClick={() => principalAction("logout").catch(fail)}>Desconectar</ActionButton></div>
      </article>
      {senders.map((sender) => {
      const busy = actionId.startsWith(sender.id);
      return <article key={sender.id} className="rounded-lg border border-line bg-panel p-5 shadow-soft">
        <div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="flex items-center gap-2 font-semibold text-ink"><Phone size={17} /> <span className="truncate">{sender.label}</span></div><div className="mt-1 text-sm text-muted">{sender.phone_number || "Número aguardando conexão"}</div></div><StatusBadge status={sender.status} /></div>
        <dl className="mt-5 grid gap-3 border-y border-line py-4 text-sm"><div className="flex justify-between gap-4"><dt className="text-muted">Nome no WhatsApp</dt><dd className="text-right font-medium">{sender.display_name || "Não disponível"}</dd></div><div className="flex justify-between gap-4"><dt className="text-muted">Adicionado em</dt><dd className="text-right">{formatDate(sender.created_at)}</dd></div><div className="flex justify-between gap-4"><dt className="text-muted">Identificador</dt><dd className="max-w-48 truncate font-mono text-xs" title={sender.session_name}>{sender.session_name}</dd></div></dl>
        {sender.qr ? <div className="mt-4"><p className="mb-3 text-center text-sm text-muted">Escaneie com o WhatsApp deste número</p><div className="flex justify-center rounded-lg bg-wash p-4"><img src={sender.qr} alt={`QR Code de ${sender.label}`} className="h-56 w-56 rounded-lg bg-white p-2" /></div></div> : null}
        <div className="mt-4 flex flex-wrap gap-2">
          <ActionButton icon={<QrCode size={15} />} disabled={busy} className="border border-line bg-white text-ink" onClick={() => runAction(sender, "connect").catch(fail)}>Gerar QR</ActionButton>
          <ActionButton icon={<RefreshCw size={15} />} disabled={busy || sender.status !== "connected"} className="border border-line bg-white text-ink" onClick={() => runAction(sender, "refresh-groups").catch(fail)}>Atualizar grupos</ActionButton>
          <ActionButton icon={<Unplug size={15} />} disabled={busy || sender.status !== "connected"} className="border border-line bg-white text-ink" onClick={() => runAction(sender, "disconnect").catch(fail)}>Desconectar</ActionButton>
          <button type="button" title="Excluir número" disabled={busy} onClick={() => setDeleteTarget(sender)} className="ml-auto grid h-10 w-10 place-items-center rounded-lg border border-red-200 text-red-600 transition hover:bg-red-50 disabled:opacity-40"><Trash2 size={16} /></button>
        </div>
      </article>;
    })}
      {!senders.length ? <div className="lg:col-span-1"><EmptyState title="Nenhum número adicional" description="Adicione outro número para separar seus disparos por campanha." /></div> : null}
    </div>}

    <ConfirmModal open={Boolean(deleteTarget)} title="Excluir número?" onCancel={() => setDeleteTarget(null)} onConfirm={deleteSender} confirmLabel="Excluir número" loading={actionId.endsWith(":delete")} destructive>
      Tem certeza de que deseja excluir este número? Ele será desconectado, removido das campanhas e os disparos ainda pendentes serão cancelados. O histórico dos envios já realizados será preservado.
    </ConfirmModal>
    <Toast message={toast} />
  </AppShell>;
}
