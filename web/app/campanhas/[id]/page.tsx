"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ActionButton, AppShell, ConfirmModal, CopyButton, EmptyState, LoadingState, StatusBadge, Toast } from "@/components/ui";
import { ArrowDown, ArrowUp, ChevronRight, ExternalLink, GripVertical, Link2, Loader2, Plus, RefreshCw, RotateCcw, X } from "lucide-react";

type Group = {
  group_jid: string;
  nome?: string;
  foto_url?: string | null;
  position: number;
  manual_status: "disponivel" | "cheio" | "pausado";
  participant_limit?: number | null;
  safety_margin: number;
  participant_count?: number | null;
  participants_synced_at?: string | null;
  participants_sync_error?: string | null;
  invite_url?: string | null;
  redirection_count: number;
  capacity_reached_at?: string | null;
  situacao: string;
};

type Campaign = {
  id: string;
  nome: string;
  public_slug: string;
  status: "ativa" | "pausada" | "encerrada";
  link_ativo: boolean;
  fallback_type: "padrao" | "url";
  fallback_url?: string | null;
  reuse_available_groups: boolean;
  allow_stale_participant_count: boolean;
  total_accesses: number;
  total_redirects: number;
  whatsapp_sender_id?: string | null;
  whatsapp_senders?: { id: string; label: string; session_name: string } | null;
  active_group_jid?: string | null;
  next_group_jid?: string | null;
  created_at: string;
  groups: Group[];
};

type Event = { id: string; group_jid?: string | null; result: string; reason?: string | null; utm?: Record<string, string>; destination_url?: string | null; created_at: string };
type Sender = { id: string; label: string };
type AvailableGroup = { group_jid: string; nome?: string };
type DetailData = { campaign: Campaign; events: Event[]; metrics: { accesses: number; redirects: number; failures: number; daily: { date: string; count: number }[]; sources: { source: string; count: number }[] } };

function formatDate(value?: string | null) {
  return value ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(value)) : "Nunca atualizado";
}

function localDateKey(value: string) {
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function situationTone(situation: string) {
  if (situation === "Recebendo leads") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (["Pausado", "Marcado manualmente como cheio", "Limite de participantes atingido", "Falha na sincronização", "Link de convite inválido"].includes(situation)) return "border-amber-200 bg-amber-50 text-amber-700";
  return "border-line bg-wash text-muted";
}

function reasonLabel(reason?: string | null) {
  const labels: Record<string, string> = {
    campanha_pausada: "Campanha pausada",
    campanha_encerrada: "Campanha encerrada",
    link_pausado: "Link pausado",
    nenhum_grupo_disponivel: "Nenhum grupo disponível"
  };
  return reason ? labels[reason] || reason : "Sem grupo disponível";
}

export default function CampanhaDetailPage({ params }: { params: { id: string } }) {
  const [detail, setDetail] = useState<DetailData | null>(null);
  const [senders, setSenders] = useState<Sender[]>([]);
  const [allGroups, setAllGroups] = useState<AvailableGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState("");
  const [toast, setToast] = useState("");
  const [publicOrigin, setPublicOrigin] = useState("");
  const [fallbackType, setFallbackType] = useState<"padrao" | "url">("padrao");
  const [fallbackUrl, setFallbackUrl] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [addQuery, setAddQuery] = useState("");
  const [addJids, setAddJids] = useState<string[]>([]);
  const [inviteLink, setInviteLink] = useState("");
  const [removeTarget, setRemoveTarget] = useState<Group | null>(null);
  const [resetTarget, setResetTarget] = useState<Group | null>(null);
  const [regenerateOpen, setRegenerateOpen] = useState(false);
  const [draggedJid, setDraggedJid] = useState("");
  const [historyStatus, setHistoryStatus] = useState("");
  const [historyGroup, setHistoryGroup] = useState("");
  const [historyDate, setHistoryDate] = useState("");

  const campaign = detail?.campaign;
  const groups = useMemo(() => campaign?.groups || [], [campaign?.groups]);
  const publicUrl = campaign ? `${publicOrigin}/c/${campaign.public_slug}` : "";

  function showMessage(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(""), 3500);
  }

  async function load(sync = false) {
    if (sync) await fetch(`/api/campanhas/${params.id}/sync-groups`, { method: "POST" }).catch(() => undefined);
    const [detailResponse, senderResponse] = await Promise.all([
      fetch(`/api/campanhas/${params.id}/redirect`, { cache: "no-store" }),
      fetch("/api/whatsapp/senders", { cache: "no-store" })
    ]);
    const [detailData, senderData] = await Promise.all([detailResponse.json(), senderResponse.json()]);
    if (!detailResponse.ok) throw new Error(detailData.error || "Falha ao carregar a campanha.");
    setDetail(detailData);
    setSenders(senderData.senders || []);
    setFallbackType(detailData.campaign.fallback_type || "padrao");
    setFallbackUrl(detailData.campaign.fallback_url || "");
  }

  useEffect(() => {
    setPublicOrigin(window.location.origin);
    load(true).catch((error) => showMessage(error.message)).finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id]);

  async function patch(body: Record<string, unknown>, success: string) {
    const response = await fetch(`/api/campanhas/${params.id}/redirect`, { method: "PATCH", body: JSON.stringify(body) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Não foi possível salvar a configuração.");
    showMessage(success);
    await load();
  }

  async function updateNow() {
    setSaving("sync");
    try {
      const response = await fetch(`/api/campanhas/${params.id}/sync-groups`, { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Falha ao atualizar participantes.");
      showMessage("Participantes atualizados pelo WhatsApp.");
      await load();
    } catch (error: any) { showMessage(error.message); } finally { setSaving(""); }
  }

  async function updateSender(senderId: string) {
    setSaving("sender");
    try {
      const response = await fetch("/api/campanhas", { method: "PATCH", body: JSON.stringify({ id: params.id, whatsapp_sender_id: senderId || null }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Falha ao atualizar o número.");
      showMessage("Número responsável atualizado.");
      await load(true);
    } catch (error: any) { showMessage(error.message); } finally { setSaving(""); }
  }

  async function openAdd() {
    setSaving("load-groups");
    try {
      const url = campaign?.whatsapp_sender_id ? `/api/whatsapp/senders/${campaign.whatsapp_sender_id}/refresh-groups` : "/api/whatsapp/groups/refresh";
      const response = await fetch(url, { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Não foi possível carregar os grupos deste número.");
      setAllGroups(Array.isArray(data.groups) ? data.groups : []);
      setAddJids([]);
      setAddQuery("");
      setInviteLink("");
      setShowAdd(true);
    } finally {
      setSaving("");
    }
  }

  async function resolveInvite() {
    if (!inviteLink.trim()) return;
    setSaving("resolve-invite");
    try {
      const response = await fetch("/api/whatsapp/groups/resolve-invite", {
        method: "POST",
        body: JSON.stringify({
          invite_url: inviteLink.trim(),
          sender_id: campaign?.whatsapp_sender_id || null
        })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Não foi possível identificar o grupo.");
      const group = data.group as AvailableGroup;
      setAllGroups((current) => [group, ...current.filter((item) => item.group_jid !== group.group_jid)]);
      setAddJids((current) => Array.from(new Set([...current, group.group_jid])));
      setInviteLink("");
      showMessage(`${group.nome || "Grupo"} encontrado e selecionado.`);
    } catch (error: any) {
      showMessage(error.message);
    } finally {
      setSaving("");
    }
  }

  async function addGroups() {
    if (!campaign || !addJids.length) return;
    setSaving("add");
    try {
      const response = await fetch("/api/campanhas", { method: "PATCH", body: JSON.stringify({ id: campaign.id, group_jids: [...groups.map((group) => group.group_jid), ...addJids] }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Falha ao adicionar os grupos.");
      setShowAdd(false);
      showMessage("Grupos adicionados à campanha.");
      await load(true);
    } catch (error: any) { showMessage(error.message); } finally { setSaving(""); }
  }

  async function removeGroup() {
    if (!campaign || !removeTarget) return;
    setSaving("remove");
    try {
      const response = await fetch("/api/campanhas", { method: "PATCH", body: JSON.stringify({ id: campaign.id, group_jids: groups.map((group) => group.group_jid).filter((jid) => jid !== removeTarget.group_jid) }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Falha ao remover o grupo.");
      setRemoveTarget(null);
      showMessage("Grupo removido apenas desta campanha.");
      await load();
    } catch (error: any) { showMessage(error.message); } finally { setSaving(""); }
  }

  async function reorder(nextJids: string[]) {
    const previous = detail;
    if (detail && campaign) setDetail({ ...detail, campaign: { ...campaign, groups: nextJids.map((jid, index) => ({ ...groups.find((group) => group.group_jid === jid)!, position: index + 1 })) } });
    try { await patch({ action: "reorder", group_jids: nextJids }, "Ordem dos grupos salva."); }
    catch (error: any) { setDetail(previous); showMessage(error.message); }
  }

  function moveGroup(index: number, direction: number) {
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= groups.length) return;
    const next = groups.map((group) => group.group_jid);
    [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
    reorder(next);
  }

  const availableGroups = useMemo(() => {
    const current = new Set(groups.map((group) => group.group_jid));
    const query = addQuery.toLowerCase();
    return allGroups.filter((group) => !current.has(group.group_jid) && `${group.nome || ""} ${group.group_jid}`.toLowerCase().includes(query));
  }, [addQuery, allGroups, groups]);

  const history = useMemo(() => (detail?.events || []).filter((event) => (!historyStatus || event.result === historyStatus) && (!historyGroup || event.group_jid === historyGroup) && (!historyDate || localDateKey(event.created_at) === historyDate)), [detail?.events, historyDate, historyGroup, historyStatus]);
  const groupNames = new Map(groups.map((group) => [group.group_jid, group.nome || group.group_jid]));

  if (loading) return <AppShell title="Campanha"><LoadingState /></AppShell>;
  if (!campaign || !detail) return <AppShell title="Campanha"><EmptyState title="Campanha não encontrada" description="Volte para Campanhas e selecione outra opção." /></AppShell>;

  return <AppShell title={campaign.nome} subtitle="Link inteligente e grupos da campanha" action={<ActionButton disabled={saving === "load-groups"} icon={saving === "load-groups" ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />} onClick={() => openAdd().catch((error) => showMessage(error.message))}>{saving === "load-groups" ? "Carregando" : "Adicionar grupos"}</ActionButton>}>
    <nav className="mb-6 flex items-center gap-1.5 text-sm text-muted"><Link href="/campanhas" className="hover:text-ink">Campanhas</Link><ChevronRight size={14} /><span className="text-ink">{campaign.nome}</span></nav>

    <section className="mb-8">
      <h2 className="text-lg font-semibold text-ink">Visão geral</h2>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-7">
        {[{ label: "Status", value: campaign.status === "ativa" ? "Ativa" : campaign.status === "pausada" ? "Pausada" : "Encerrada" }, { label: "Grupos", value: groups.length }, { label: "Grupo atual", value: groupNames.get(campaign.active_group_jid || "") || "Nenhum" }, { label: "Próximo grupo", value: groupNames.get(campaign.next_group_jid || "") || "Nenhum" }, { label: "Acessos", value: detail.metrics.accesses }, { label: "Redirecionamentos", value: detail.metrics.redirects }, { label: "Sem destino", value: detail.metrics.failures }].map((item) => <div key={item.label} className="rounded-lg border border-line bg-white p-4"><div className="text-xs text-muted">{item.label}</div><div className="mt-2 truncate text-xl font-semibold text-ink" title={String(item.value)}>{item.value}</div></div>)}
      </div>
    </section>

    <section className="mb-8 rounded-lg border border-line bg-white p-5 shadow-soft">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div><h2 className="text-lg font-semibold text-ink">Link de redirecionamento</h2><p className="mt-1 text-sm text-muted">O link permanece igual mesmo quando os grupos mudam de posição.</p></div>
        <div className="flex flex-wrap gap-2"><CopyButton value={publicUrl} /><a href={publicUrl} target="_blank" rel="noreferrer" className="inline-flex h-9 items-center gap-2 rounded-lg border border-line px-3 text-sm font-medium"><ExternalLink size={15} />Abrir link</a><button type="button" onClick={() => setRegenerateOpen(true)} className="inline-flex h-9 items-center gap-2 rounded-lg border border-line px-3 text-sm font-medium"><RotateCcw size={15} />Regenerar</button></div>
      </div>
      <div className="mt-4 break-all rounded-lg bg-wash p-3 font-mono text-sm text-ink">{publicUrl}</div>
      <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <label className="text-sm font-medium text-ink">Status da campanha<select value={campaign.status} onChange={(event) => patch({ action: "campaign_settings", status: event.target.value }, "Status da campanha atualizado.").catch((error) => showMessage(error.message))} className="focus-ring mt-1 h-10 w-full rounded-lg border border-line bg-white px-3"><option value="ativa">Ativa</option><option value="pausada">Pausada</option><option value="encerrada">Encerrada</option></select></label>
        <label className="text-sm font-medium text-ink">Status do link<select value={campaign.link_ativo ? "ativo" : "pausado"} onChange={(event) => patch({ action: "campaign_settings", link_ativo: event.target.value === "ativo" }, "Status do link atualizado.").catch((error) => showMessage(error.message))} className="focus-ring mt-1 h-10 w-full rounded-lg border border-line bg-white px-3"><option value="ativo">Ativo</option><option value="pausado">Pausado</option></select></label>
        <label className="text-sm font-medium text-ink">Número conectado<select value={campaign.whatsapp_sender_id || ""} disabled={saving === "sender"} onChange={(event) => updateSender(event.target.value)} className="focus-ring mt-1 h-10 w-full rounded-lg border border-line bg-white px-3"><option value="">Número principal</option>{senders.map((sender) => <option key={sender.id} value={sender.id}>{sender.label}</option>)}</select></label>
        <div className="text-sm"><div className="font-medium text-ink">Criado em</div><div className="mt-3 text-muted">{formatDate(campaign.created_at)}</div></div>
      </div>
      <div className="mt-5 border-t border-line pt-5">
        <h3 className="font-medium text-ink">Destino quando todos os grupos estiverem indisponíveis</h3>
        <div className="mt-3 flex flex-col gap-3 lg:flex-row">
          <select value={fallbackType} onChange={(event) => setFallbackType(event.target.value as "padrao" | "url")} className="focus-ring h-10 rounded-lg border border-line bg-white px-3 text-sm"><option value="padrao">Página padrão do Disparei</option><option value="url">URL personalizada</option></select>
          {fallbackType === "url" ? <input value={fallbackUrl} onChange={(event) => setFallbackUrl(event.target.value)} placeholder="https://..." className="focus-ring h-10 flex-1 rounded-lg border border-line px-3 text-sm" /> : null}
          <ActionButton onClick={() => patch({ action: "campaign_settings", fallback_type: fallbackType, fallback_url: fallbackType === "url" ? fallbackUrl : null }, "Destino de contingência salvo.").catch((error) => showMessage(error.message))}>Salvar destino</ActionButton>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <label className="flex items-start gap-3 rounded-lg border border-line p-3 text-sm"><input type="checkbox" className="mt-1" checked={campaign.reuse_available_groups} onChange={(event) => patch({ action: "campaign_settings", reuse_available_groups: event.target.checked }, "Regra de reutilização atualizada.").catch((error) => showMessage(error.message))} /><span><span className="block font-medium text-ink">Reutilizar grupos que voltarem a ter vagas</span><span className="text-muted">Desativado por padrão para evitar alternância entre grupos.</span></span></label>
          <label className="flex items-start gap-3 rounded-lg border border-line p-3 text-sm"><input type="checkbox" className="mt-1" checked={campaign.allow_stale_participant_count} onChange={(event) => patch({ action: "campaign_settings", allow_stale_participant_count: event.target.checked }, "Uso da última contagem atualizado.").catch((error) => showMessage(error.message))} /><span><span className="block font-medium text-ink">Usar última quantidade confirmada se a sincronização falhar</span><span className="text-muted">Nunca substitui participantes por cliques.</span></span></label>
        </div>
      </div>
    </section>

    <section className="mb-8">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div><h2 className="text-lg font-semibold text-ink">Grupos da campanha</h2><p className="mt-1 text-sm text-muted">O primeiro grupo disponível abaixo do limite recebe os leads.</p></div><ActionButton icon={saving === "sync" ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />} disabled={saving === "sync"} className="border border-line bg-white text-ink" onClick={updateNow}>Atualizar participantes agora</ActionButton></div>
      {!groups.length ? <EmptyState title="Nenhum grupo nesta campanha" description="Adicione grupos para ativar o link inteligente." /> : <div className="space-y-3">
        {groups.map((group, index) => <article key={group.group_jid} draggable onDragStart={() => setDraggedJid(group.group_jid)} onDragOver={(event) => event.preventDefault()} onDrop={() => { const from = groups.findIndex((item) => item.group_jid === draggedJid); if (from >= 0 && from !== index) { const next = groups.map((item) => item.group_jid); const [moved] = next.splice(from, 1); next.splice(index, 0, moved); reorder(next); } setDraggedJid(""); }} className={`rounded-lg border bg-white p-4 shadow-soft ${campaign.active_group_jid === group.group_jid ? "border-emerald-400" : "border-line"}`}>
          <div className="flex items-start gap-3">
            <div className="mt-1 hidden cursor-grab text-muted sm:block"><GripVertical size={18} /></div>
            <div className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-wash bg-cover bg-center font-semibold text-muted" style={group.foto_url ? { backgroundImage: `url(${group.foto_url})` } : undefined}>{group.foto_url ? null : index + 1}</div>
            <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h3 className="truncate font-semibold text-ink">{index + 1}. {group.nome || group.group_jid}</h3><span className={`rounded-full border px-2 py-1 text-xs font-medium ${situationTone(group.situacao)}`}>{group.situacao}</span></div><div className="mt-1 text-xs text-muted">{campaign.whatsapp_senders?.label || "Número principal"}</div></div>
            <div className="flex shrink-0 gap-1"><button title="Mover para cima" disabled={index === 0} onClick={() => moveGroup(index, -1)} className="grid h-9 w-9 place-items-center rounded-lg border border-line disabled:opacity-30"><ArrowUp size={15} /></button><button title="Mover para baixo" disabled={index === groups.length - 1} onClick={() => moveGroup(index, 1)} className="grid h-9 w-9 place-items-center rounded-lg border border-line disabled:opacity-30"><ArrowDown size={15} /></button><button title="Remover da campanha" onClick={() => setRemoveTarget(group)} className="grid h-9 w-9 place-items-center rounded-lg border border-red-200 text-red-600"><X size={15} /></button></div>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <div className="rounded-lg bg-wash p-3"><div className="text-xs text-muted">Participantes reais</div><div className="mt-1 font-semibold text-ink">{group.participant_count == null ? "Indisponível" : `${group.participant_count}${group.participant_limit ? ` de ${group.participant_limit}` : ""}`}</div>{group.participant_count != null && group.participant_limit != null ? <div className="mt-1 text-xs text-muted">Vagas estimadas: {Math.max(0, group.participant_limit - group.participant_count)}</div> : null}<div className="mt-1 text-xs text-muted">{formatDate(group.participants_synced_at)}</div>{group.capacity_reached_at ? <div className="mt-1 text-xs text-muted">Limite atingido em {formatDate(group.capacity_reached_at)}</div> : null}</div>
            <label className="text-xs font-medium text-muted">Status manual<select value={group.manual_status} onChange={(event) => patch({ action: "group_settings", group_jid: group.group_jid, manual_status: event.target.value }, "Status do grupo atualizado.").catch((error) => showMessage(error.message))} className="focus-ring mt-1 h-10 w-full rounded-lg border border-line bg-white px-3 text-sm text-ink"><option value="disponivel">Disponível</option><option value="cheio">Cheio</option><option value="pausado">Pausado</option></select></label>
            <label className="text-xs font-medium text-muted">Limite de participantes<input type="number" min="1" defaultValue={group.participant_limit || ""} placeholder="Sem limite" onBlur={(event) => patch({ action: "group_settings", group_jid: group.group_jid, participant_limit: event.target.value ? Number(event.target.value) : null }, "Limite atualizado.").catch((error) => showMessage(error.message))} className="focus-ring mt-1 h-10 w-full rounded-lg border border-line px-3 text-sm text-ink" /></label>
            <label className="text-xs font-medium text-muted">Margem de segurança<input type="number" min="0" defaultValue={group.safety_margin || 0} onBlur={(event) => patch({ action: "group_settings", group_jid: group.group_jid, safety_margin: Number(event.target.value || 0) }, "Margem atualizada.").catch((error) => showMessage(error.message))} className="focus-ring mt-1 h-10 w-full rounded-lg border border-line px-3 text-sm text-ink" /></label>
            <div className="rounded-lg bg-wash p-3"><div className="text-xs text-muted">Redirecionamentos do link</div><div className="mt-1 font-semibold text-ink">{group.redirection_count || 0}</div><button type="button" onClick={() => setResetTarget(group)} className="mt-1 text-xs font-medium underline underline-offset-2">Zerar contador</button></div>
          </div>
          <label className="mt-3 block text-xs font-medium text-muted">Link de convite<input defaultValue={group.invite_url || ""} placeholder="https://chat.whatsapp.com/..." onBlur={(event) => patch({ action: "group_settings", group_jid: group.group_jid, invite_url: event.target.value || null }, "Link de convite salvo.").catch((error) => showMessage(error.message))} className="focus-ring mt-1 h-10 w-full rounded-lg border border-line px-3 text-sm text-ink" /></label>
          {group.participants_sync_error ? <details className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800"><summary className="cursor-pointer font-medium">Não foi possível atualizar a quantidade de participantes</summary><p className="mt-2">{group.participants_sync_error}</p><p className="mt-1 text-xs">Última sincronização bem-sucedida: {formatDate(group.participants_synced_at)}</p></details> : null}
        </article>)}
      </div>}
    </section>

    <section className="mb-8 grid gap-5 xl:grid-cols-2">
      <div><h2 className="text-lg font-semibold text-ink">Acessos por dia</h2><div className="mt-3 divide-y divide-line rounded-lg border border-line bg-white">{detail.metrics.daily.slice(0, 14).map((item) => <div key={item.date} className="flex justify-between px-4 py-3 text-sm"><span>{new Date(`${item.date}T12:00:00`).toLocaleDateString("pt-BR")}</span><strong>{item.count}</strong></div>)}{!detail.metrics.daily.length ? <div className="p-5 text-sm text-muted">Nenhum acesso registrado.</div> : null}</div></div>
      <div><h2 className="text-lg font-semibold text-ink">Origem dos acessos</h2><div className="mt-3 divide-y divide-line rounded-lg border border-line bg-white">{detail.metrics.sources.slice(0, 14).map((item) => <div key={item.source} className="flex justify-between px-4 py-3 text-sm"><span>{item.source}</span><strong>{item.count}</strong></div>)}{!detail.metrics.sources.length ? <div className="p-5 text-sm text-muted">Nenhuma origem registrada.</div> : null}</div></div>
    </section>

    <section>
      <div className="mb-4"><h2 className="text-lg font-semibold text-ink">Histórico</h2><div className="mt-3 flex flex-wrap gap-3"><select value={historyStatus} onChange={(event) => setHistoryStatus(event.target.value)} className="focus-ring h-10 rounded-lg border border-line bg-white px-3 text-sm"><option value="">Todos os resultados</option><option value="redirecionado">Redirecionados</option><option value="sem_redirecionamento">Sem redirecionamento</option></select><select value={historyGroup} onChange={(event) => setHistoryGroup(event.target.value)} className="focus-ring h-10 rounded-lg border border-line bg-white px-3 text-sm"><option value="">Todos os grupos</option>{groups.map((group) => <option key={group.group_jid} value={group.group_jid}>{group.nome || group.group_jid}</option>)}</select><input type="date" value={historyDate} onChange={(event) => setHistoryDate(event.target.value)} aria-label="Filtrar por data" className="focus-ring h-10 rounded-lg border border-line bg-white px-3 text-sm" /></div></div>
      {!history.length ? <EmptyState title="Nenhum acesso registrado" description="O histórico aparecerá quando alguém utilizar o link da campanha." /> : <div className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-white">{history.map((event) => <div key={event.id} className="grid gap-3 px-4 py-3 text-sm md:grid-cols-[160px_150px_1fr_auto] md:items-center"><div>{formatDate(event.created_at)}</div><StatusBadge status={event.result === "redirecionado" ? "sucesso" : "erro"} /><div className="min-w-0 truncate">{groupNames.get(event.group_jid || "") || reasonLabel(event.reason)}</div><details><summary className="cursor-pointer font-medium">Detalhes</summary><pre className="mt-2 max-w-sm overflow-auto rounded-lg bg-wash p-3 text-xs">{JSON.stringify({ utm: event.utm, destino: event.destination_url, motivo: reasonLabel(event.reason) }, null, 2)}</pre></details></div>)}</div>}
    </section>

    {showAdd ? <div className="fixed inset-0 z-50 grid place-items-center bg-black/45 p-4" onClick={() => saving !== "add" && setShowAdd(false)}><div className="flex max-h-[88vh] w-full max-w-lg flex-col overflow-hidden rounded-lg bg-white" onClick={(event) => event.stopPropagation()}><div className="border-b border-line p-5"><h2 className="font-semibold text-ink">Adicionar grupos</h2></div><div className="flex-1 overflow-y-auto p-5"><div className="mb-4 rounded-lg border border-line bg-wash p-3"><label className="text-sm font-medium text-ink">Buscar pelo link do grupo</label><div className="mt-2 flex gap-2"><input value={inviteLink} onChange={(event) => setInviteLink(event.target.value)} placeholder="https://chat.whatsapp.com/..." className="focus-ring h-10 min-w-0 flex-1 rounded-lg border border-line bg-white px-3 text-sm" /><button type="button" title="Buscar grupo" disabled={!inviteLink.trim() || saving === "resolve-invite"} onClick={resolveInvite} className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-black text-white disabled:opacity-40">{saving === "resolve-invite" ? <Loader2 size={16} className="animate-spin" /> : <Link2 size={16} />}</button></div><p className="mt-2 text-xs text-muted">Use esta opção quando o grupo aparecer apenas como código.</p></div><input autoFocus value={addQuery} onChange={(event) => setAddQuery(event.target.value)} placeholder="Pesquisar grupos" className="focus-ring h-10 w-full rounded-lg border border-line px-3 text-sm" /><div className="mt-3 max-h-72 space-y-2 overflow-y-auto rounded-lg border border-line p-3">{availableGroups.map((group) => <label key={group.group_jid} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={addJids.includes(group.group_jid)} onChange={(event) => setAddJids((current) => event.target.checked ? [...current, group.group_jid] : current.filter((jid) => jid !== group.group_jid))} /><span>{group.nome || group.group_jid}</span></label>)}{!availableGroups.length ? <div className="py-5 text-center text-sm text-muted">Nenhum grupo disponível.</div> : null}</div><p className="mt-3 text-sm text-muted">{addJids.length} selecionado(s)</p></div><div className="flex justify-end gap-2 border-t border-line p-4"><ActionButton className="border border-line bg-white text-ink" onClick={() => setShowAdd(false)}>Cancelar</ActionButton><ActionButton disabled={!addJids.length || saving === "add"} onClick={addGroups}>{saving === "add" ? "Adicionando..." : "Adicionar selecionados"}</ActionButton></div></div></div> : null}

    <ConfirmModal open={Boolean(removeTarget)} title="Remover grupo?" confirmLabel="Remover da campanha" destructive loading={saving === "remove"} onCancel={() => setRemoveTarget(null)} onConfirm={removeGroup}>O grupo continuará existindo no WhatsApp e no sistema. Apenas o vínculo com esta campanha será removido.</ConfirmModal>
    <ConfirmModal open={Boolean(resetTarget)} title="Zerar redirecionamentos?" confirmLabel="Zerar contador" destructive onCancel={() => setResetTarget(null)} onConfirm={() => { if (!resetTarget) return; patch({ action: "reset_redirect_count", group_jid: resetTarget.group_jid }, "Contador zerado.").then(() => setResetTarget(null)).catch((error) => showMessage(error.message)); }}>Essa ação zera somente a métrica de redirecionamentos do Disparei. A quantidade real de participantes não será alterada.</ConfirmModal>
    <ConfirmModal open={regenerateOpen} title="Regenerar link público?" confirmLabel="Regenerar link" destructive onCancel={() => setRegenerateOpen(false)} onConfirm={() => patch({ action: "regenerate_slug" }, "Novo link público criado.").then(() => setRegenerateOpen(false)).catch((error) => showMessage(error.message))}>O link atual deixará de funcionar imediatamente. Atualize todos os locais onde ele foi divulgado.</ConfirmModal>
    <Toast message={toast} />
  </AppShell>;
}
