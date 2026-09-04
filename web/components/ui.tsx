"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { BrandLogo } from "./brand-logo";
import {
  AlertTriangle,
  BarChart3,
  Check,
  ChevronRight,
  Clipboard,
  ShoppingBag,
  Clock,
  Cable,
  Cog,
  FolderOpen,
  Inbox,
  Loader2,
  LogOut,
  Menu,
  Megaphone,
  MessageCircle,
  Pause,
  Play,
  QrCode,
  RefreshCw,
  Search,
  Send,
  Smartphone,
  Upload,
  UserPlus,
  Zap,
  X
} from "lucide-react";
import { ReactNode, useEffect, useId, useMemo, useState } from "react";

const navSections = [
  { label: "Principal", items: [
    { href: "/dashboard", label: "Início", icon: BarChart3 },
    { href: "/grupos/numeros", label: "Números", icon: Smartphone },
    { href: "/campanhas", label: "Campanhas", icon: Megaphone },
    { href: "/catalogo", label: "Catálogo", icon: ShoppingBag, badge: "NOVO" },
    { href: "/integracoes", label: "Integrações", icon: Cable },
    { href: "/grupos/modelos", label: "Modelos", icon: FolderOpen },
    { href: "/disparos", label: "Disparos", icon: Send },
    { href: "/piloto-automatico", label: "Piloto Automático", icon: Zap },
    { href: "/comunidade", label: "Comunidade", icon: MessageCircle }
  ] },
  { label: "Conta", items: [
    { href: "/configuracoes", label: "Configurações", icon: Cog }
  ] }
];

const adminNavSection = { label: "Administração", items: [
  { href: "/admin/contas", label: "Contas", icon: UserPlus },
  { href: "/admin/mercado-livre-catalog", label: "Mercado Livre", icon: ShoppingBag },
] };
const officialNavSection = { label: "WhatsApp API oficial", items: [
  { href: "/admin/whatsapp-oficial", label: "Painel", icon: BarChart3, exact: true },
  { href: "/admin/whatsapp-oficial/contas", label: "Contas de API", icon: Smartphone },
  { href: "/admin/whatsapp-oficial/automacoes", label: "Automações", icon: Zap },
  { href: "/admin/whatsapp-oficial/fluxos", label: "Fluxos para disparos", icon: FolderOpen },
  { href: "/admin/whatsapp-oficial/disparos", label: "Disparos 1 a 1", icon: Send },
  { href: "/admin/whatsapp-oficial/historico", label: "Histórico", icon: Clock },
  { href: "/admin/whatsapp-oficial/configuracoes", label: "Configurações da API", icon: Cog }
] };

const mobilePrimaryNav = [
  { href: "/dashboard", label: "Início", icon: BarChart3 },
  { href: "/campanhas", label: "Campanhas", icon: Megaphone },
  { href: "/disparos", label: "Disparos", icon: Send },
  { href: "/catalogo", label: "Catálogo", icon: ShoppingBag }
];

const mobileTopNav = [
  { href: "/grupos/numeros", label: "Conectar número", icon: Smartphone },
  { href: "/piloto-automatico", label: "Piloto Automático", icon: Zap },
  { href: "/comunidade", label: "Comunidade", icon: MessageCircle },
  { href: "/grupos/modelos", label: "Modelos", icon: FolderOpen },
  { href: "/integracoes", label: "Integrações", icon: Cable },
  { href: "/configuracoes", label: "Configurações", icon: Cog }
];

export function AppShell({ children, title, subtitle, action, hideLogout = false }: { children: ReactNode; title: string; subtitle?: string; action?: ReactNode; hideLogout?: boolean }) {
  const pathname = usePathname();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  useEffect(() => {
    if (!mobileMenuOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previous; };
  }, [mobileMenuOpen]);
  useEffect(() => { setMobileMenuOpen(false); }, [pathname]);
  return (
    <div className="min-h-dvh min-w-0 lg:flex">
      <aside className="sticky top-0 hidden h-screen w-72 shrink-0 overflow-y-auto border-r border-line bg-white px-4 py-5 lg:block">
        <div className="mb-8 px-2">
          <BrandLogo className="h-12 w-full" imageClassName="w-[250px]" />
        </div>
        <SidebarNav pathname={pathname} />
      </aside>
      {mobileMenuOpen ? <div className="fixed inset-0 z-40 bg-black/35 lg:hidden" role="presentation" onClick={() => setMobileMenuOpen(false)}>
        <aside aria-label="Menu principal" className="app-safe-bottom h-dvh w-[min(88vw,340px)] overflow-y-auto overscroll-contain bg-white px-4 pb-5 pt-[max(1.25rem,env(safe-area-inset-top))] shadow-soft" onClick={(event) => event.stopPropagation()}>
          <div className="mb-7 flex items-center justify-between gap-3 px-2"><BrandLogo className="h-11 min-w-0 flex-1" imageClassName="w-[220px] max-w-full" /><button type="button" aria-label="Fechar menu" onClick={() => setMobileMenuOpen(false)} className="touch-target grid shrink-0 place-items-center rounded-lg border border-line text-muted"><X size={20} /></button></div>
          <SidebarNav pathname={pathname} onNavigate={() => setMobileMenuOpen(false)} />
        </aside>
      </div> : null}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-10 border-b border-line bg-white/95 px-[var(--app-gutter)] pb-3 pt-[max(.75rem,env(safe-area-inset-top))] backdrop-blur lg:py-4">
          <div className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-3">
            <div className="contents sm:flex sm:min-w-0 sm:items-start sm:gap-3">
              <button type="button" aria-label="Abrir menu" aria-expanded={mobileMenuOpen} onClick={() => setMobileMenuOpen(true)} className="touch-target grid shrink-0 place-items-center rounded-lg border border-line bg-white text-ink lg:hidden"><Menu size={20} /></button>
              <div className="min-w-0 sm:flex-1">
              <h1 className="break-words text-lg font-semibold leading-tight tracking-normal text-ink sm:text-xl">{title}</h1>
              {subtitle ? <p className="mt-1 break-words text-xs leading-5 text-muted sm:text-sm">{subtitle}</p> : null}
              </div>
            </div>
            <div className="col-start-3 row-start-1 flex items-center justify-end gap-2">
              <div className="hidden items-center gap-2 sm:flex">{action}</div>
              {!hideLogout ? <form action="/api/auth/logout" method="post">
                <button className="touch-target inline-flex items-center gap-2 rounded-lg border border-line bg-panel px-3 text-sm text-muted hover:text-ink" title="Sair">
                  <LogOut size={16} /> <span className="hidden sm:inline">Sair</span>
                </button>
              </form> : null}
            </div>
            {action ? <div className="col-span-3 flex min-w-0 justify-stretch pl-14 [&>*]:w-full sm:hidden">{action}</div> : null}
          </div>
          <nav aria-label="Atalhos das funções" className="scrollbar-subtle -mx-[var(--app-gutter)] mt-3 flex gap-2 overflow-x-auto border-t border-line px-[var(--app-gutter)] pt-3 lg:hidden">
            {mobileTopNav.map((item) => {
              const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
              const Icon = item.icon;
              return <Link key={item.href} href={item.href} aria-current={active ? "page" : undefined} className={`inline-flex min-h-10 shrink-0 items-center gap-2 rounded-full border px-3 text-xs font-medium ${active ? "border-black bg-black text-white" : "border-line bg-white text-muted"}`}><Icon size={15}/>{item.label}</Link>;
            })}
          </nav>
        </header>
        <main className="min-w-0 flex-1 overflow-x-clip px-[var(--app-gutter)] pb-28 pt-5 sm:py-6">{children}</main>
      </div>
      <nav aria-label="Navegação rápida" className="app-safe-bottom fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-line bg-white/95 px-1 pt-1 shadow-[0_-8px_30px_rgba(0,0,0,0.08)] backdrop-blur lg:hidden">
        {mobilePrimaryNav.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          const Icon = item.icon;
          return <Link key={item.href} href={item.href} aria-current={active ? "page" : undefined} className={`flex min-h-14 min-w-0 flex-col items-center justify-center gap-1 rounded-lg px-1 text-[10px] font-medium ${active ? "text-ink" : "text-muted"}`}><Icon size={20} strokeWidth={active ? 2.5 : 2}/><span className="max-w-full truncate">{item.label}</span></Link>;
        })}
        <button type="button" aria-label="Abrir todas as funções" aria-expanded={mobileMenuOpen} onClick={() => setMobileMenuOpen(true)} className={`flex min-h-14 min-w-0 flex-col items-center justify-center gap-1 rounded-lg px-1 text-[10px] font-medium ${mobileMenuOpen ? "text-ink" : "text-muted"}`}><Menu size={20}/><span>Mais</span></button>
      </nav>
    </div>
  );
}

function SidebarNav({ pathname, onNavigate }: { pathname: string; onNavigate?: () => void }) {
  const [communityUnread, setCommunityUnread] = useState(0);
  const [internalAdmin, setInternalAdmin] = useState(pathname.startsWith("/admin"));
  useEffect(() => {
    let alive = true;
    const load = () => fetch("/api/comunidade/notifications", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((body) => { if (alive && body) setCommunityUnread(body.unread_count || 0); })
      .catch(() => {});
    load();
    const interval = setInterval(load, 60_000);
    return () => { alive = false; clearInterval(interval); };
  }, []);
  useEffect(() => {
    let alive = true;
    fetch("/api/admin/access", { cache: "no-store" })
      .then((response) => response.ok ? response.json() : null)
      .then((body) => { if (alive && body?.admin) setInternalAdmin(true); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);
  const sections = internalAdmin
    ? pathname.startsWith("/admin/whatsapp-oficial")
      ? [officialNavSection, adminNavSection, ...navSections]
      : [...navSections, adminNavSection, officialNavSection]
    : navSections;
  return <nav className="space-y-6" aria-label="Navegação principal">
    {sections.map((section) => <div key={section.label}>
      <div className="mb-2 px-3 text-[11px] font-semibold uppercase tracking-normal text-zinc-400">{section.label}</div>
      <div className="space-y-1">{section.items.map((item) => {
        const match = "match" in item ? item.match : item.href;
        const active = pathname === match || (!("exact" in item && item.exact) && pathname.startsWith(`${match}/`)) || (item.href === "/admin/whatsapp-oficial" && pathname === "/admin/whatsapp-oficial/operacao");
        const Icon = item.icon;
        const dynamicBadge = item.href === "/comunidade" && communityUnread > 0 ? (communityUnread > 9 ? "9+" : String(communityUnread)) : null;
        const badge = dynamicBadge || ("badge" in item && item.badge ? String(item.badge) : null);
        return <Link key={item.href} href={item.href} onClick={onNavigate} className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition ${active ? "bg-black text-white" : "text-muted hover:bg-wash hover:text-ink"}`}><Icon size={18} /><span className="whitespace-nowrap">{item.label}</span>{badge ? <span className={`ml-auto rounded-full px-2 py-0.5 text-[9px] font-bold tracking-wide ${active ? "bg-white/20" : dynamicBadge ? "bg-red-100 text-red-700" : "bg-emerald-100 text-emerald-700"}`}>{badge}</span> : null}</Link>;
      })}</div>
    </div>)}
  </nav>;
}

export function StatusBadge({ status }: { status?: string | null }) {
  const s = status || "sem dados";
  const cls = {
    sucesso: "bg-emerald-50 text-emerald-700 border-emerald-200",
    active: "bg-emerald-50 text-emerald-700 border-emerald-200",
    connected: "bg-emerald-50 text-emerald-700 border-emerald-200",
    erro: "bg-red-50 text-red-700 border-red-200",
    disconnected: "bg-red-50 text-red-700 border-red-200",
    incerto: "bg-amber-50 text-amber-700 border-amber-200",
    pausado: "bg-slate-100 text-slate-700 border-slate-200",
    cancelado: "bg-slate-100 text-slate-700 border-slate-200",
    processando: "bg-blue-50 text-blue-700 border-blue-200",
    programado: "bg-blue-50 text-blue-700 border-blue-200",
    enfileirado: "bg-indigo-50 text-indigo-700 border-indigo-200",
    pendente: "bg-zinc-50 text-zinc-700 border-zinc-200"
  } as Record<string, string>;
  const labels: Record<string, string> = {
    connected: "Conectado",
    active: "Ativa",
    disconnected: "Desconectado",
    sucesso: "Enviado",
    erro: "Falhou",
    incerto: "Não confirmado",
    pausado: "Pausada",
    cancelado: "Cancelada",
    processando: "Enviando",
    programado: "Programado",
    enfileirado: "Aguardando",
    pendente: "Aguardando"
  };
  return <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${cls[s] || cls.pendente}`}>{labels[s] || s}</span>;
}

export function PriorityBadge({ priority }: { priority: "alta" | "normal" }) {
  return <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${priority === "alta" ? "bg-coral/10 text-coral" : "bg-accent/10 text-accent"}`}>{priority}</span>;
}

export function StatCard({ label, value, icon }: { label: string; value: ReactNode; icon?: ReactNode }) {
  return <div className="rounded-lg border border-line bg-panel p-5 shadow-soft"><div className="flex items-center justify-between gap-3"><div className="text-sm text-muted">{label}</div><div className="text-muted">{icon}</div></div><div className="mt-3 text-2xl font-semibold text-ink">{value}</div></div>;
}

export function DataTable({ columns, rows }: { columns: string[]; rows: ReactNode[][] }) {
  if (!rows.length) return <EmptyState title="Sem dados" description="Nada encontrado para os filtros atuais." />;
  return <div className="min-w-0">
    <div className="space-y-3 md:hidden">{rows.map((row, i) => <article key={i} className="min-w-0 overflow-hidden rounded-xl border border-line bg-panel p-4 shadow-soft"><dl className="space-y-3">{row.map((cell, j) => <div key={j} className={`min-w-0 ${j ? "border-t border-line/70 pt-3" : ""}`}><dt className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted">{columns[j] || `Campo ${j + 1}`}</dt><dd className="min-w-0 break-words text-sm text-ink [&_button]:min-h-10 [&_code]:break-all [&_pre]:max-w-full">{cell}</dd></div>)}</dl></article>)}</div>
    <div className="scrollbar-subtle hidden overflow-x-auto rounded-lg border border-line bg-panel shadow-soft md:block" tabIndex={0} aria-label="Tabela com rolagem horizontal"><table className="min-w-full text-left text-sm"><thead className="bg-wash text-xs uppercase text-muted"><tr>{columns.map((c) => <th key={c} className="whitespace-nowrap px-4 py-3 font-medium">{c}</th>)}</tr></thead><tbody className="divide-y divide-line">{rows.map((row, i) => <tr key={i} className="hover:bg-wash/60">{row.map((cell, j) => <td key={j} className="px-4 py-3 align-top">{cell}</td>)}</tr>)}</tbody></table></div>
  </div>;
}

export function EmptyState({ title, description }: { title: string; description: string }) {
  return <div className="rounded-lg border border-dashed border-line bg-panel p-8 text-center"><Inbox className="mx-auto text-muted" /><h3 className="mt-3 font-semibold text-ink">{title}</h3><p className="mt-1 text-sm text-muted">{description}</p></div>;
}

export function LoadingState() {
  return <div className="grid min-h-48 place-items-center rounded-lg border border-line bg-panel"><Loader2 className="animate-spin text-accent" /></div>;
}

export function ErrorState({ message }: { message: string }) {
  return <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{message}</div>;
}

export function AlertCard({ tone = "normal", title, children }: { tone?: "normal" | "critical"; title: string; children: ReactNode }) {
  const critical = tone === "critical";
  return <div className={`rounded-lg border p-4 ${critical ? "border-red-200 bg-red-50 text-red-800" : "border-amber-200 bg-amber-50 text-amber-800"}`}><div className="flex gap-3"><AlertTriangle size={18} /><div><div className="font-medium">{title}</div><div className="mt-1 text-sm">{children}</div></div></div></div>;
}

export function ProgressBar({ value }: { value: number }) {
  return <div className="h-2 overflow-hidden rounded-full bg-line"><div className="h-full rounded-full bg-accent" style={{ width: `${Math.max(0, Math.min(100, value))}%` }} /></div>;
}

export function CopyButton({ value }: { value: string }) {
  const [done, setDone] = useState(false);
  return <button type="button" className="inline-flex h-9 items-center gap-2 rounded-lg border border-line px-3 text-sm text-muted" onClick={async () => { await navigator.clipboard.writeText(value); setDone(true); setTimeout(() => setDone(false), 1200); }}>{done ? <Check size={15} /> : <Clipboard size={15} />} {done ? "Copiado" : "Copiar"}</button>;
}

export function FileDropzone({ onFile }: { onFile: (file: File) => void }) {
  const [name, setName] = useState("");
  return <label className="flex cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed border-line bg-wash p-6 text-center hover:bg-white"><Upload className="text-muted" /><span className="mt-2 text-sm font-medium text-ink">{name || "Selecionar arquivo"}</span><span className="mt-1 text-xs text-muted">Upload direto ao Supabase Storage</span><input className="sr-only" type="file" onChange={(e) => { const f = e.target.files?.[0]; if (f) { setName(f.name); onFile(f); } }} /></label>;
}

export function MediaPreview({ fileName, mimeType }: { fileName?: string; mimeType?: string }) {
  if (!fileName) return null;
  return <div className="rounded-lg border border-line bg-panel p-3 text-sm"><div className="font-medium text-ink">{fileName}</div><div className="text-muted">{mimeType}</div></div>;
}

export function DateTimePicker(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} type="datetime-local" className="focus-ring h-11 rounded-lg border border-line bg-panel px-3 text-sm" />;
}

export function PhoneMaskedText({ value }: { value: string }) {
  return <span className="font-mono text-sm">{value}</span>;
}

export function ConfirmModal({ open, title, children, onCancel, onConfirm, confirmLabel = "Confirmar", loading = false, destructive = false }: { open: boolean; title: string; children: ReactNode; onCancel: () => void; onConfirm: () => void; confirmLabel?: string; loading?: boolean; destructive?: boolean }) {
  const titleId = useId();
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape" && !loading) onCancel(); };
    window.addEventListener("keydown", onKeyDown);
    return () => { document.body.style.overflow = previous; window.removeEventListener("keydown", onKeyDown); };
  }, [open, loading, onCancel]);
  if (!open) return null;
  return <div className="fixed inset-0 z-50 flex items-end bg-black/45 sm:grid sm:place-items-center sm:p-4" onMouseDown={(event) => { if (event.target === event.currentTarget && !loading) onCancel(); }}><div role="dialog" aria-modal="true" aria-labelledby={titleId} className="app-safe-bottom max-h-[min(90dvh,720px)] w-full overflow-y-auto rounded-t-2xl bg-panel p-5 shadow-soft sm:max-w-md sm:rounded-xl"><div className="mx-auto mb-4 h-1 w-10 rounded-full bg-zinc-300 sm:hidden"/><h3 id={titleId} className="break-words font-semibold text-ink">{title}</h3><div className="mt-2 break-words text-sm text-muted">{children}</div><div className="mt-5 grid grid-cols-2 gap-2 sm:flex sm:justify-end"><button type="button" disabled={loading} className="touch-target rounded-lg border border-line px-4 py-2 text-sm disabled:opacity-50" onClick={onCancel}>Voltar</button><button type="button" disabled={loading} className={`touch-target inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm text-white disabled:opacity-50 ${destructive ? "bg-red-600 hover:bg-red-700" : "bg-black hover:bg-zinc-800"}`} onClick={onConfirm}>{loading ? <Loader2 size={15} className="animate-spin" /> : null}{confirmLabel}</button></div></div></div>;
}

export function Toast({ message }: { message: string }) {
  if (!message) return null;
  return <div role="status" aria-live="polite" className="fixed inset-x-4 bottom-[max(1rem,env(safe-area-inset-bottom))] z-[60] mx-auto max-w-md break-words rounded-xl bg-ink px-4 py-3 text-center text-sm text-white shadow-soft sm:left-auto sm:right-4 sm:mx-0 sm:text-left">{message}</div>;
}

export function ConnectionStatusCard({ status, qr }: { status?: string; qr?: string }) {
  return <div className="min-w-0 rounded-lg border border-line bg-panel p-4 shadow-soft sm:p-6"><div className="flex flex-wrap items-center justify-between gap-3"><div className="min-w-0"><div className="text-sm text-muted">WhatsApp</div><div className="mt-1 break-words text-lg font-semibold text-ink">{status || "desconectado"}</div></div><StatusBadge status={status} /></div>{qr ? <div className="mt-6 flex justify-center rounded-lg bg-wash p-3 sm:p-5"><Image src={qr} alt="QR Code do WhatsApp" width={288} height={288} unoptimized className="aspect-square h-auto w-full max-w-72 rounded-lg bg-white p-3" /></div> : null}</div>;
}

export function UncertainStatusCard({ critical, item, onAction }: { critical?: boolean; item: any; onAction?: (action: string, item: any) => void }) {
  return <div className={`rounded-lg border p-4 ${critical ? "border-red-200 bg-red-50" : "border-amber-200 bg-amber-50"}`}><div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><div className="font-medium text-ink">{item.nome || item.nome_grupo || "Envio não confirmado"}</div><div className="mt-1 text-sm text-muted">{item.erro || "Aguardando revisão manual."}</div></div><div className="flex gap-2"><button className="rounded-lg bg-accent px-3 py-2 text-sm text-white" onClick={() => onAction?.("success", item)}><Check size={15} /></button><button className="rounded-lg bg-coral px-3 py-2 text-sm text-white" onClick={() => onAction?.("error", item)}><X size={15} /></button><button className="rounded-lg border border-line bg-panel px-3 py-2 text-sm" onClick={() => onAction?.("retry", item)}><RefreshCw size={15} /></button></div></div></div>;
}

export function SearchInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <div className="relative"><Search className="pointer-events-none absolute left-3 top-3 text-muted" size={16} /><input {...props} className="focus-ring h-11 w-full rounded-lg border border-line bg-panel pl-9 pr-3 text-sm" /></div>;
}

export function ActionButton({ children, icon, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { icon?: ReactNode }) {
  return <button {...props} className={`inline-flex min-h-11 max-w-full items-center justify-center gap-2 rounded-lg px-4 text-center text-sm font-medium transition disabled:opacity-50 ${props.className || "bg-accent text-white hover:bg-accent/90"}`}>{icon}{children}</button>;
}

export const Icons = { ChevronRight, Clock, Pause, Play, RefreshCw, Send };

export function useApi<T>(url: string, fallback: T) {
  const [data, setData] = useState<T>(fallback);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    fetch(url, { cache: "no-store" })
      .then((r) => r.ok ? r.json() : Promise.reject(new Error("Falha ao carregar dados.")))
      .then((json) => alive && setData(json))
      .catch((e) => alive && setError(e.message))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [url]);
  return useMemo(() => ({ data, loading, error, setData }), [data, loading, error]);
}
