"use client";

import Link from "next/link";
import { use, useEffect, useMemo, useState } from "react";
import { ActionButton, AppShell, ConfirmModal, CopyButton, EmptyState, LoadingState, StatusBadge, Toast } from "@/components/ui";
import { ArrowDown, ArrowUp, CalendarDays, ChevronRight, Download, ExternalLink, GripVertical, Link2, Loader2, Plus, RefreshCw, RotateCcw, TrendingDown, TrendingUp, Users, X } from "lucide-react";

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
type Period = "hoje" | "ontem" | "7dias" | "30dias" | "este-mes" | "mes-passado" | "personalizado";

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
    nenhum_grupo_disponivel: "Nenhum grupo disponível",
  };
  return reason ? labels[reason] || reason : "Sem grupo disponível";
}

function getPeriodRange(period: Period, customStart = "", customEnd = "") {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const MS = 86_400_000;
  if (period === "hoje") return { start: todayStart, end: now, prevStart: new Date(todayStart.getTime() - MS), prevEnd: todayStart };
  if (period === "ontem") { const s = new Date(todayStart.getTime() - MS); return { start: s, end: todayStart, prevStart: new Date(s.getTime() - MS), prevEnd: s }; }
  if (period === "7dias") { const s = new Date(todayStart.getTime() - 7 * MS); return { start: s, end: now, prevStart: new Date(s.getTime() - 7 * MS), prevEnd: s }; }
  if (period === "30dias") { const s = new Date(todayStart.getTime() - 30 * MS); return { start: s, end: now, prevStart: new Date(s.getTime() - 30 * MS), prevEnd: s }; }
  if (period === "este-mes") { const s = new Date(now.getFullYear(), now.getMonth(), 1); const ps = new Date(now.getFullYear(), now.getMonth() - 1, 1); return { start: s, end: now, prevStart: ps, prevEnd: s }; }
  if (period === "mes-passado") { const s = new Date(now.getFullYear(), now.getMonth() - 1, 1); const e = new Date(now.getFullYear(), now.getMonth(), 1); return { start: s, end: e, prevStart: new Date(now.getFullYear(), now.getMonth() - 2, 1), prevEnd: s }; }
  const s = customStart ? new Date(customStart) : todayStart;
  const e = customEnd ? new Date(new Date(customEnd).getTime() + MS) : now;
  return { start: s, end: e, prevStart: new Date(s.getTime() - (e.getTime() - s.getTime())), prevEnd: s };
}

function deltaPercent(current: number, prev: number): number | null {
  return prev === 0 ? null : ((current - prev) / prev) * 100;
}

function periodVsLabel(period: Period): string {
  const map: Record<Period, string> = { hoje: "vs ontem", ontem: "vs anteontem", "7dias": "vs 7 dias anteriores", "30dias": "vs 30 dias anteriores", "este-mes": "vs mês passado", "mes-passado": "vs mês retrasado", personalizado: "vs período anterior" };
  return map[period];
}

export default function CampanhaDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
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
  const [period, setPeriod] = useState<Period>("hoje");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [downloadingGroup, setDownloadingGroup] = useState("");

  const campaign = detail?.campaign;
  const groups = useMemo(() => campaign?.groups || [], [campaign?.groups]);
  const publicUrl = campaign ? `${publicOrigin}/c/${campaign.public_slug}` : "";

  const periodRange = useMemo(() => getPeriodRange(period, customStart, customEnd), [period, customStart, customEnd]);

  const currentEvents = useMemo(() => {
    const { start, end } = periodRange;
    return (detail?.events || []).filter((e) => { const t = new Date(e.created_at).getTime(); return t >= start.getTime() && t < end.getTime(); });
  }, [detail?.events, periodRange]);

  const prevEvents = useMemo(() => {
    const { prevStart, prevEnd } = periodRange;
    return (detail?.events || []).filter((e) => { const t = new Date(e.created_at).getTime(); return t >= prevStart.getTime() && t < prevEnd.getTime(); });
  }, [detail?.events, periodRange]);

  const summaryMetrics = useMemo(() => {
    const entered = currentEvents.filter((e) => e.result === "redirecionado").length;
    const left = currentEvents.filter((e) => e.result !== "redirecionado").length;
    const prevEntered = prevEvents.filter((e) => e.result === "redirecionado").length;
    const prevLeft = prevEvents.filter((e) => e.result !== "redirecionado").length;
    const totalParticipants = groups.reduce((sum, g) => sum + (g.participant_count ?? 0), 0);
    return { totalParticipants, entered, left, balance: entered - left, enteredDelta: deltaPercent(entered, prevEntered), leftDelta: deltaPercent(left, prevLeft) };
  }, [currentEvents, prevEvents, groups]);

  const groupMetrics = useMemo(() => {
    const map = new Map<string, { entered: number }>();
    for (const g of groups) map.set(g.group_jid, { entered: 0 });
    for (const e of currentEvents) {
      if (e.group_jid && map.has(e.group_jid) && e.result === "redirecionado") map.get(e.group_jid)!.entered++;
    }
    return map;
  }, [groups, currentEvents]);

  const dateRangeLabel = useMemo(() => {
    const { start, end } = periodRange;
    const fmt = (d: Date) => d.toLocaleDateString("pt-BR");
    return period === "hoje" || period === "ontem" ? fmt(start) : `${fmt(start)} – ${fmt(end)}`;
  }, [periodRange, period]);

  function showMessage(message: string) { setToast(message); window.setTimeout(() => setToast(""), 3500); }

  async function downloadGroupContacts(group: Group) {
    if (!campaign?.whatsapp_sender_id) throw new Error("Selecione um número para a campanha antes de baixar os contatos.");
    setDownloadingGroup(group.group_jid);
    try {
      const response = await fetch(`/api/whatsapp/groups/${encodeURIComponent(group.group_jid)}/contacts?sender_id=${encodeURIComponent(campaign.whatsapp_sender_id)}`);
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || "Não foi possível baixar os contatos.");
      }
      const blob = await response.blob();
      const disposition = response.headers.get("content-disposition") || "";
      const filename = disposition.match(/filename="([^"]+)"/)?.[1] || "contatos-do-grupo.csv";
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url; anchor.download = filename; anchor.click();
      URL.revokeObjectURL(url);
      showMessage("Contatos baixados com sucesso.");
    } finally {
      setDownloadingGroup("");
    }
  }

  async function load(sync = false) {
    if (sync) await fetch(`/api/campanhas/${id}/sync-groups`, { method: "POST" }).catch(() => undefined);
    const [dr, sr] = await Promise.all([fetch(`/api/campanhas/${id}/redirect`, { cache: "no-store" }), fetch("/api/whatsapp/senders", { cache: "no-store" })]);
    const [dd, sd] = await Promise.all([dr.json(), sr.json()]);
    if (!dr.ok) throw new Error(dd.error || "Falha ao carregar a campanha.");
    setDetail(dd); setSenders(sd.senders || []); setFallbackType(dd.campaign.fallback_type || "padrao"); setFallbackUrl(dd.campaign.fallback_url || "");
  }

  useEffect(() => {
    setPublicOrigin(window.location.origin);
    load(true).catch((e) => showMessage(e.message)).finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function patch(body: Record<string, unknown>, success: string) {
    const r = await fetch(`/api/campanhas/${id}/redirect`, { method: "PATCH", body: JSON.stringify(body) });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || "Não foi possível salvar a configuração.");
    showMessage(success); await load();
  }

  async function updateNow() {
    setSaving("sync");
    try {
      const r = await fetch(`/api/campanhas/${id}/sync-groups`, { method: "POST" });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Falha ao atualizar participantes.");
      showMessage("Participantes atualizados."); await load();
    } catch (e: any) { showMessage(e.message); } finally { setSaving(""); }
  }

  async function updateInviteLinks() {
    setSaving("invite-links");
    try {
      const r = await fetch(`/api/campanhas/${id}/sync-invite-links`, { method: "POST" });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Falha ao atualizar os links dos grupos.");
      showMessage(d.updated === 1 ? "Link de 1 grupo atualizado." : `Links de ${d.updated || 0} grupos atualizados.`);
      await load();
    } catch (e: any) { showMessage(e.message); } finally { setSaving(""); }
  }

  async function updateSender(senderId: string) {
    setSaving("sender");
    try {
      const r = await fetch("/api/campanhas", { method: "PATCH", body: JSON.stringify({ id, whatsapp_sender_id: senderId || null }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Falha ao atualizar o número.");
      showMessage("Número atualizado."); await load(true);
    } catch (e: any) { showMessage(e.message); } finally { setSaving(""); }
  }

  async function openAdd() {
    setSaving("load-groups");
    try {
      const url = campaign?.whatsapp_sender_id ? `/api/whatsapp/senders/${campaign.whatsapp_sender_id}/refresh-groups` : "/api/whatsapp/groups/refresh";
      const r = await fetch(url, { method: "POST" });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Não foi possível carregar os grupos.");
      setAllGroups(Array.isArray(d.groups) ? d.groups : []); setAddJids([]); setAddQuery(""); setInviteLink(""); setShowAdd(true);
    } finally { setSaving(""); }
  }

  async function resolveInvite() {
    if (!inviteLink.trim()) return;
    setSaving("resolve-invite");
    try {
      const r = await fetch("/api/whatsapp/groups/resolve-invite", { method: "POST", body: JSON.stringify({ invite_url: inviteLink.trim(), sender_id: campaign?.whatsapp_sender_id || null }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Não foi possível identificar o grupo.");
      const g = d.group as AvailableGroup;
      setAllGroups((c) => [g, ...c.filter((i) => i.group_jid !== g.group_jid)]);
      setAddJids((c) => Array.from(new Set([...c, g.group_jid])));
      setInviteLink(""); showMessage(`${g.nome || "Grupo"} encontrado.`);
    } catch (e: any) { showMessage(e.message); } finally { setSaving(""); }
  }

  async function addGroups() {
    if (!campaign || !addJids.length) return;
    setSaving("add");
    try {
      const r = await fetch("/api/campanhas", { method: "PATCH", body: JSON.stringify({ id: campaign.id, group_jids: [...groups.map((g) => g.group_jid), ...addJids] }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Falha ao adicionar os grupos.");
      setShowAdd(false); showMessage("Grupos adicionados."); await load(true);
    } catch (e: any) { showMessage(e.message); } finally { setSaving(""); }
  }

  async function removeGroup() {
    if (!campaign || !removeTarget) return;
    setSaving("remove");
    try {
      const r = await fetch("/api/campanhas", { method: "PATCH", body: JSON.stringify({ id: campaign.id, group_jids: groups.map((g) => g.group_jid).filter((jid) => jid !== removeTarget.group_jid) }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Falha ao remover o grupo.");
      setRemoveTarget(null); showMessage("Grupo removido."); await load();
    } catch (e: any) { showMessage(e.message); } finally { setSaving(""); }
  }

  async function reorder(nextJids: string[]) {
    const previous = detail;
    if (detail && campaign) setDetail({ ...detail, campaign: { ...campaign, groups: nextJids.map((jid, i) => ({ ...groups.find((g) => g.group_jid === jid)!, position: i + 1 })) } });
    try { await patch({ action: "reorder", group_jids: nextJids }, "Ordem salva."); }
    catch (e: any) { setDetail(previous); showMessage(e.message); }
  }

  function moveGroup(index: number, direction: number) {
    const next = index + direction;
    if (next < 0 || next >= groups.length) return;
    const jids = groups.map((g) => g.group_jid);
    [jids[index], jids[next]] = [jids[next], jids[index]];
    reorder(jids);
  }

  const availableGroups = useMemo(() => {
    const current = new Set(groups.map((g) => g.group_jid));
    const q = addQuery.toLowerCase();
    return allGroups.filter((g) => !current.has(g.group_jid) && `${g.nome || ""} ${g.group_jid}`.toLowerCase().includes(q));
  }, [addQuery, allGroups, groups]);

  const history = useMemo(() => (detail?.events || []).filter((e) => (!historyStatus || e.result === historyStatus) && (!historyGroup || e.group_jid === historyGroup) && (!historyDate || localDateKey(e.created_at) === historyDate)), [detail?.events, historyDate, historyGroup, historyStatus]);
  const groupNames = new Map(groups.map((g) => [g.group_jid, g.nome || g.group_jid]));

  if (loading) return <AppShell title="Campanha"><LoadingState /></AppShell>;
  if (!campaign || !detail) return <AppShell title="Campanha"><EmptyState title="Campanha não encontrada" description="Volte para Campanhas e selecione outra opção." /></AppShell>;

  const vsLabel = periodVsLabel(period);

  return (
    <AppShell
      title={campaign.nome}
      subtitle="Link inteligente e grupos da campanha"
      action={
        <ActionButton disabled={saving === "load-groups"} icon={saving === "load-groups" ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />} onClick={() => openAdd().catch((e) => showMessage(e.message))}>
          {saving === "load-groups" ? "Carregando" : "Adicionar grupos"}
        </ActionButton>
      }
    >
      <nav className="mb-6 flex items-center gap-1.5 text-sm text-muted">
        <Link href="/campanhas" className="hover:text-ink">Campanhas</Link>
        <ChevronRight size={14} />
        <span className="text-ink">{campaign.nome}</span>
      </nav>

      {/* ── Bloco 1: Cards de resumo ─────────────────────────────────── */}
      <div className="mb-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-xl border border-line bg-white p-5 shadow-soft">
          <div className="flex items-center justify-between">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-wash">
              <Users size={15} className="text-muted" />
            </div>
            <span className="text-xs text-muted">{groups.length} grupo{groups.length !== 1 ? "s" : ""}</span>
          </div>
          <div className="mt-4 text-3xl font-bold tracking-tight text-ink">{summaryMetrics.totalParticipants.toLocaleString("pt-BR")}</div>
          <div className="mt-1 text-sm font-medium text-ink">Participantes atuais</div>
          <div className="mt-0.5 text-xs text-muted">Total nos {groups.length} grupos</div>
        </div>

        <div className="rounded-xl border border-line bg-white p-5 shadow-soft">
          <div className="flex items-center justify-between">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-50">
              <TrendingUp size={15} className="text-emerald-600" />
            </div>
            {summaryMetrics.enteredDelta !== null && (
              <span className={`text-xs font-semibold ${summaryMetrics.enteredDelta >= 0 ? "text-emerald-600" : "text-red-500"}`}>
                {summaryMetrics.enteredDelta >= 0 ? "+" : ""}{summaryMetrics.enteredDelta.toFixed(1)}%
              </span>
            )}
          </div>
          <div className="mt-4 text-3xl font-bold tracking-tight text-ink">{summaryMetrics.entered.toLocaleString("pt-BR")}</div>
          <div className="mt-1 text-sm font-medium text-ink">Entraram</div>
          <div className="mt-0.5 text-xs text-muted">{vsLabel}</div>
        </div>

        <div className="rounded-xl border border-line bg-white p-5 shadow-soft">
          <div className="flex items-center justify-between">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-red-50">
              <TrendingDown size={15} className="text-red-500" />
            </div>
            {summaryMetrics.leftDelta !== null && (
              <span className={`text-xs font-semibold ${summaryMetrics.leftDelta <= 0 ? "text-emerald-600" : "text-red-500"}`}>
                {summaryMetrics.leftDelta >= 0 ? "+" : ""}{summaryMetrics.leftDelta.toFixed(1)}%
              </span>
            )}
          </div>
          <div className="mt-4 text-3xl font-bold tracking-tight text-ink">{summaryMetrics.left.toLocaleString("pt-BR")}</div>
          <div className="mt-1 text-sm font-medium text-ink">Saíram</div>
          <div className="mt-0.5 text-xs text-muted">{vsLabel}</div>
        </div>

        <div className="rounded-xl border border-line bg-white p-5 shadow-soft">
          <div className="flex items-center justify-between">
            <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${summaryMetrics.balance >= 0 ? "bg-emerald-50" : "bg-red-50"}`}>
              {summaryMetrics.balance >= 0 ? <TrendingUp size={15} className="text-emerald-600" /> : <TrendingDown size={15} className="text-red-500" />}
            </div>
          </div>
          <div className={`mt-4 text-3xl font-bold tracking-tight ${summaryMetrics.balance >= 0 ? "text-emerald-600" : "text-red-500"}`}>
            {summaryMetrics.balance >= 0 ? "+" : ""}{summaryMetrics.balance.toLocaleString("pt-BR")}
          </div>
          <div className="mt-1 text-sm font-medium text-ink">Saldo do período</div>
          <div className="mt-0.5 text-xs text-muted">{summaryMetrics.balance >= 0 ? "Novos participantes" : "Queda de participantes"}</div>
        </div>
      </div>

      {/* ── Bloco 2: Redirecionador ──────────────────────────────────── */}
      <section className="mb-8 rounded-xl border border-line bg-white p-6 shadow-soft">
        <div className="mb-1 flex items-center gap-2">
          <Link2 size={13} className="text-muted" />
          <span className="text-xs font-semibold uppercase tracking-widest text-muted">Redirecionador da Campanha</span>
        </div>
        <p className="mb-4 text-sm text-muted">O link permanece igual mesmo quando os grupos mudam de posição.</p>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="flex-1 overflow-hidden rounded-lg bg-wash px-4 py-2.5 font-mono text-sm text-ink">{publicUrl}</div>
          <div className="flex shrink-0 flex-wrap gap-2">
            <CopyButton value={publicUrl} />
            <a href={publicUrl} target="_blank" rel="noreferrer" className="inline-flex h-9 items-center gap-2 rounded-lg border border-line px-3 text-sm font-medium transition hover:bg-wash">
              <ExternalLink size={14} />Abrir link
            </a>
            <button type="button" onClick={() => setRegenerateOpen(true)} className="inline-flex h-9 items-center gap-2 rounded-lg border border-line px-3 text-sm font-medium transition hover:bg-wash">
              <RotateCcw size={14} />Regenerar
            </button>
          </div>
        </div>

        <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <label className="text-sm font-medium text-ink">
            Status da campanha
            <select value={campaign.status} onChange={(e) => patch({ action: "campaign_settings", status: e.target.value }, "Status da campanha atualizado.").catch((err) => showMessage(err.message))} className="focus-ring mt-1 h-10 w-full rounded-lg border border-line bg-white px-3">
              <option value="ativa">Ativa</option>
              <option value="pausada">Pausada</option>
              <option value="encerrada">Encerrada</option>
            </select>
          </label>
          <label className="text-sm font-medium text-ink">
            Status do link
            <select value={campaign.link_ativo ? "ativo" : "pausado"} onChange={(e) => patch({ action: "campaign_settings", link_ativo: e.target.value === "ativo" }, "Status do link atualizado.").catch((err) => showMessage(err.message))} className="focus-ring mt-1 h-10 w-full rounded-lg border border-line bg-white px-3">
              <option value="ativo">Ativo</option>
              <option value="pausado">Pausado</option>
            </select>
          </label>
          <label className="text-sm font-medium text-ink">
            Número conectado
            <select value={campaign.whatsapp_sender_id || ""} disabled={saving === "sender"} onChange={(e) => updateSender(e.target.value)} className="focus-ring mt-1 h-10 w-full rounded-lg border border-line bg-white px-3">
              <option value="">Número principal</option>
              {senders.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          </label>
          <div className="text-sm">
            <div className="font-medium text-ink">Criado em</div>
            <div className="mt-3 text-muted">{formatDate(campaign.created_at)}</div>
          </div>
        </div>
      </section>

      {/* ── Bloco 3: Grupos ──────────────────────────────────────────── */}
      <section className="mb-8">
        <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-ink">Grupos da campanha</h2>
            <p className="mt-1 text-sm text-muted">O primeiro grupo disponível abaixo do limite recebe os leads.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1.5 rounded-lg border border-line bg-white px-3 py-2 text-xs text-muted">
              <CalendarDays size={13} />
              <span>{dateRangeLabel}</span>
            </div>
            <select value={period} onChange={(e) => setPeriod(e.target.value as Period)} className="focus-ring h-9 rounded-lg border border-line bg-white px-3 text-sm">
              <option value="hoje">Hoje</option>
              <option value="ontem">Ontem</option>
              <option value="7dias">Últimos 7 dias</option>
              <option value="30dias">Últimos 30 dias</option>
              <option value="este-mes">Este mês</option>
              <option value="mes-passado">Mês passado</option>
              <option value="personalizado">Personalizado</option>
            </select>
            {period === "personalizado" && (
              <>
                <input type="date" value={customStart} onChange={(e) => setCustomStart(e.target.value)} className="focus-ring h-9 rounded-lg border border-line bg-white px-3 text-sm" />
                <input type="date" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)} className="focus-ring h-9 rounded-lg border border-line bg-white px-3 text-sm" />
              </>
            )}
            <ActionButton icon={saving === "sync" ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />} disabled={saving === "sync"} onClick={updateNow}>
              Atualizar participantes
            </ActionButton>
            <ActionButton icon={saving === "invite-links" ? <Loader2 size={15} className="animate-spin" /> : <Link2 size={15} />} disabled={saving === "invite-links"} onClick={updateInviteLinks}>
              Atualizar links dos grupos
            </ActionButton>
          </div>
        </div>

        {!groups.length
          ? <EmptyState title="Nenhum grupo nesta campanha" description="Adicione grupos para ativar o link inteligente." />
          : <div className="space-y-4">
            {groups.map((group, index) => {
              const gm = groupMetrics.get(group.group_jid) || { entered: 0 };
              const isActive = campaign.active_group_jid === group.group_jid;
              return (
                <article
                  key={group.group_jid}
                  draggable
                  onDragStart={() => setDraggedJid(group.group_jid)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => {
                    const from = groups.findIndex((g) => g.group_jid === draggedJid);
                    if (from >= 0 && from !== index) {
                      const next = groups.map((g) => g.group_jid);
                      const [moved] = next.splice(from, 1);
                      next.splice(index, 0, moved);
                      reorder(next);
                    }
                    setDraggedJid("");
                  }}
                  className={`rounded-xl border bg-white shadow-soft transition ${isActive ? "border-emerald-300" : "border-line"}`}
                >
                  <div className="p-5">
                    {/* Header */}
                    <div className="flex items-start gap-3">
                      <div className="hidden cursor-grab text-muted sm:block pt-0.5">
                        <GripVertical size={16} />
                      </div>
                      <div
                        className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-wash bg-cover bg-center text-sm font-bold text-muted"
                        style={group.foto_url ? { backgroundImage: `url(${group.foto_url})` } : undefined}
                      >
                        {group.foto_url ? null : index + 1}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="font-semibold text-ink">{index + 1}. {group.nome || group.group_jid}</h3>
                          <span className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${situationTone(group.situacao)}`}>{group.situacao}</span>
                        </div>
                        <div className="mt-0.5 text-xs text-muted">{campaign.whatsapp_senders?.label || "Número principal"}</div>
                      </div>
                      <div className="flex shrink-0 gap-1">
                        <button title="Baixar todos os contatos" disabled={downloadingGroup === group.group_jid} onClick={() => downloadGroupContacts(group).catch((err) => showMessage(err.message))} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line px-2.5 text-xs font-medium transition hover:bg-wash disabled:opacity-50">
                          {downloadingGroup === group.group_jid ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
                          <span className="hidden lg:inline">Baixar contatos</span>
                        </button>
                        <button title="Mover para cima" disabled={index === 0} onClick={() => moveGroup(index, -1)} className="grid h-8 w-8 place-items-center rounded-lg border border-line transition hover:bg-wash disabled:opacity-30"><ArrowUp size={14} /></button>
                        <button title="Mover para baixo" disabled={index === groups.length - 1} onClick={() => moveGroup(index, 1)} className="grid h-8 w-8 place-items-center rounded-lg border border-line transition hover:bg-wash disabled:opacity-30"><ArrowDown size={14} /></button>
                        <button title="Remover da campanha" onClick={() => setRemoveTarget(group)} className="grid h-8 w-8 place-items-center rounded-lg border border-red-200 text-red-600 transition hover:bg-red-50"><X size={14} /></button>
                      </div>
                    </div>

                    {/* Metric tiles */}
                    <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                      <div className="rounded-lg bg-wash p-3">
                        <div className="text-xs text-muted">Participantes atuais</div>
                        <div className="mt-1.5 text-xl font-bold text-ink">{group.participant_count == null ? "—" : group.participant_count.toLocaleString("pt-BR")}</div>
                        {group.participant_count != null && group.participant_limit != null && (
                          <div className="mt-0.5 text-xs text-muted">de {group.participant_limit.toLocaleString("pt-BR")}</div>
                        )}
                      </div>
                      <div className="rounded-lg bg-wash p-3">
                        <div className="text-xs text-muted">Entraram</div>
                        <div className="mt-1.5 text-xl font-bold text-emerald-600">{gm.entered}</div>
                        <div className="mt-0.5 text-xs text-muted">{dateRangeLabel}</div>
                      </div>
                      <div className="rounded-lg bg-wash p-3">
                        <div className="text-xs text-muted">Saíram</div>
                        <div className="mt-1.5 text-xl font-bold text-muted">—</div>
                        <div className="mt-0.5 text-xs text-muted">não rastreado</div>
                      </div>
                      <div className="rounded-lg bg-wash p-3">
                        <div className="text-xs text-muted">Saldo</div>
                        <div className={`mt-1.5 text-xl font-bold ${gm.entered > 0 ? "text-emerald-600" : "text-muted"}`}>
                          {gm.entered > 0 ? "+" : ""}{gm.entered}
                        </div>
                        <div className="mt-0.5 text-xs text-muted">{dateRangeLabel}</div>
                      </div>
                    </div>

                    {/* Settings */}
                    <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                      <label className="text-xs font-medium text-muted">
                        Status manual
                        <select value={group.manual_status} onChange={(e) => patch({ action: "group_settings", group_jid: group.group_jid, manual_status: e.target.value }, "Status do grupo atualizado.").catch((err) => showMessage(err.message))} className="focus-ring mt-1 h-9 w-full rounded-lg border border-line bg-white px-3 text-sm text-ink">
                          <option value="disponivel">Disponível</option>
                          <option value="cheio">Cheio</option>
                          <option value="pausado">Pausado</option>
                        </select>
                      </label>
                      <label className="text-xs font-medium text-muted">
                        Limite de participantes
                        <input type="number" min="1" defaultValue={group.participant_limit || ""} placeholder="Sem limite" onBlur={(e) => patch({ action: "group_settings", group_jid: group.group_jid, participant_limit: e.target.value ? Number(e.target.value) : null }, "Limite atualizado.").catch((err) => showMessage(err.message))} className="focus-ring mt-1 h-9 w-full rounded-lg border border-line px-3 text-sm text-ink" />
                      </label>
                      <div className="text-xs font-medium text-muted">
                        Redirecionamentos do link
                        <div className="mt-1 flex h-9 items-center gap-3">
                          <span className="text-sm font-semibold text-ink">{group.redirection_count || 0}</span>
                          <button type="button" onClick={() => setResetTarget(group)} className="text-xs text-muted underline underline-offset-2 transition hover:text-ink">Zerar contador</button>
                        </div>
                      </div>
                      <div className="text-xs font-medium text-muted">
                        Link de convite
                        <div className="mt-1 flex items-center gap-2">
                          <input defaultValue={group.invite_url || ""} placeholder="https://chat.whatsapp.com/..." onBlur={(e) => patch({ action: "group_settings", group_jid: group.group_jid, invite_url: e.target.value || null }, "Link de convite salvo.").catch((err) => showMessage(err.message))} className="focus-ring h-9 min-w-0 flex-1 rounded-lg border border-line px-3 text-sm text-ink" />
                          {group.invite_url && <CopyButton value={group.invite_url} />}
                        </div>
                      </div>
                    </div>

                    {/* Margem de segurança (avançado) */}
                    <div className="mt-3">
                      <label className="text-xs font-medium text-muted">
                        Margem de segurança
                        <input type="number" min="0" defaultValue={group.safety_margin || 0} onBlur={(e) => patch({ action: "group_settings", group_jid: group.group_jid, safety_margin: Number(e.target.value || 0) }, "Margem atualizada.").catch((err) => showMessage(err.message))} className="focus-ring mt-1 h-9 w-40 rounded-lg border border-line px-3 text-sm text-ink" />
                      </label>
                    </div>

                    {/* Sync error */}
                    {group.participants_sync_error ? (
                      <details className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                        <summary className="cursor-pointer font-medium">Não foi possível atualizar a quantidade de participantes</summary>
                        <p className="mt-2">{group.participants_sync_error}</p>
                        <p className="mt-1 text-xs">Última sincronização bem-sucedida: {formatDate(group.participants_synced_at)}</p>
                      </details>
                    ) : null}
                  </div>
                </article>
              );
            })}
          </div>
        }
      </section>

      {/* ── Histórico ────────────────────────────────────────────────── */}
      <section>
        <div className="mb-4">
          <h2 className="text-lg font-semibold text-ink">Histórico</h2>
          <div className="mt-3 flex flex-wrap gap-3">
            <select value={historyStatus} onChange={(e) => setHistoryStatus(e.target.value)} className="focus-ring h-10 rounded-lg border border-line bg-white px-3 text-sm">
              <option value="">Todos os resultados</option>
              <option value="redirecionado">Redirecionados</option>
              <option value="sem_redirecionamento">Sem redirecionamento</option>
            </select>
            <select value={historyGroup} onChange={(e) => setHistoryGroup(e.target.value)} className="focus-ring h-10 rounded-lg border border-line bg-white px-3 text-sm">
              <option value="">Todos os grupos</option>
              {groups.map((g) => <option key={g.group_jid} value={g.group_jid}>{g.nome || g.group_jid}</option>)}
            </select>
            <input type="date" value={historyDate} onChange={(e) => setHistoryDate(e.target.value)} aria-label="Filtrar por data" className="focus-ring h-10 rounded-lg border border-line bg-white px-3 text-sm" />
          </div>
        </div>
        {!history.length
          ? <EmptyState title="Nenhum acesso registrado" description="O histórico aparecerá quando alguém utilizar o link da campanha." />
          : <div className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-white">
            {history.map((event) => (
              <div key={event.id} className="grid gap-3 px-4 py-3 text-sm md:grid-cols-[160px_150px_1fr_auto] md:items-center">
                <div>{formatDate(event.created_at)}</div>
                <StatusBadge status={event.result === "redirecionado" ? "sucesso" : "erro"} />
                <div className="min-w-0 truncate">{groupNames.get(event.group_jid || "") || reasonLabel(event.reason)}</div>
                <details>
                  <summary className="cursor-pointer font-medium">Detalhes</summary>
                  <pre className="mt-2 max-w-sm overflow-auto rounded-lg bg-wash p-3 text-xs">{JSON.stringify({ utm: event.utm, destino: event.destination_url, motivo: reasonLabel(event.reason) }, null, 2)}</pre>
                </details>
              </div>
            ))}
          </div>
        }
      </section>

      {/* ── Modal: Adicionar grupos ───────────────────────────────────── */}
      {showAdd ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/45 p-4" onClick={() => saving !== "add" && setShowAdd(false)}>
          <div className="flex max-h-[88vh] w-full max-w-lg flex-col overflow-hidden rounded-xl bg-white" onClick={(e) => e.stopPropagation()}>
            <div className="border-b border-line p-5"><h2 className="font-semibold text-ink">Adicionar grupos</h2></div>
            <div className="flex-1 overflow-y-auto p-5">
              <div className="mb-4 rounded-xl border border-line bg-wash p-3">
                <label className="text-sm font-medium text-ink">Buscar pelo link do grupo</label>
                <div className="mt-2 flex gap-2">
                  <input value={inviteLink} onChange={(e) => setInviteLink(e.target.value)} placeholder="https://chat.whatsapp.com/..." className="focus-ring h-10 min-w-0 flex-1 rounded-lg border border-line bg-white px-3 text-sm" />
                  <button type="button" disabled={!inviteLink.trim() || saving === "resolve-invite"} onClick={resolveInvite} className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-black text-white disabled:opacity-40">
                    {saving === "resolve-invite" ? <Loader2 size={16} className="animate-spin" /> : <Link2 size={16} />}
                  </button>
                </div>
                <p className="mt-2 text-xs text-muted">Use esta opção quando o grupo aparecer apenas como código.</p>
              </div>
              <input autoFocus value={addQuery} onChange={(e) => setAddQuery(e.target.value)} placeholder="Pesquisar grupos" className="focus-ring h-10 w-full rounded-lg border border-line px-3 text-sm" />
              <div className="mt-3 max-h-72 space-y-2 overflow-y-auto rounded-lg border border-line p-3">
                {availableGroups.map((g) => (
                  <label key={g.group_jid} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={addJids.includes(g.group_jid)} onChange={(e) => setAddJids((c) => e.target.checked ? [...c, g.group_jid] : c.filter((jid) => jid !== g.group_jid))} />
                    <span>{g.nome || g.group_jid}</span>
                  </label>
                ))}
                {!availableGroups.length && <div className="py-5 text-center text-sm text-muted">Nenhum grupo disponível.</div>}
              </div>
              <p className="mt-3 text-sm text-muted">{addJids.length} selecionado(s)</p>
            </div>
            <div className="flex justify-end gap-2 border-t border-line p-4">
              <ActionButton className="border border-line bg-white text-ink" onClick={() => setShowAdd(false)}>Cancelar</ActionButton>
              <ActionButton disabled={!addJids.length || saving === "add"} onClick={addGroups}>{saving === "add" ? "Adicionando..." : "Adicionar selecionados"}</ActionButton>
            </div>
          </div>
        </div>
      ) : null}

      <ConfirmModal open={Boolean(removeTarget)} title="Remover grupo?" confirmLabel="Remover da campanha" destructive loading={saving === "remove"} onCancel={() => setRemoveTarget(null)} onConfirm={removeGroup}>
        O grupo continuará existindo no WhatsApp e no sistema. Apenas o vínculo com esta campanha será removido.
      </ConfirmModal>
      <ConfirmModal open={Boolean(resetTarget)} title="Zerar redirecionamentos?" confirmLabel="Zerar contador" destructive onCancel={() => setResetTarget(null)} onConfirm={() => { if (!resetTarget) return; patch({ action: "reset_redirect_count", group_jid: resetTarget.group_jid }, "Contador zerado.").then(() => setResetTarget(null)).catch((err) => showMessage(err.message)); }}>
        Essa ação zera somente a métrica de redirecionamentos do Disparei. A quantidade real de participantes não será alterada.
      </ConfirmModal>
      <ConfirmModal open={regenerateOpen} title="Regenerar link público?" confirmLabel="Regenerar link" destructive onCancel={() => setRegenerateOpen(false)} onConfirm={() => patch({ action: "regenerate_slug" }, "Novo link público criado.").then(() => setRegenerateOpen(false)).catch((err) => showMessage(err.message))}>
        O link atual deixará de funcionar imediatamente. Atualize todos os locais onde ele foi divulgado.
      </ConfirmModal>
      <Toast message={toast} />
    </AppShell>
  );
}
