"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  AlertTriangle,
  BarChart3,
  Check,
  ChevronRight,
  Clipboard,
  Clock,
  Cog,
  FileText,
  HelpCircle,
  Inbox,
  Loader2,
  LogOut,
  MessageCircle,
  Pause,
  Play,
  QrCode,
  RefreshCw,
  Search,
  Send,
  Shield,
  Upload,
  Users,
  X
} from "lucide-react";
import { ReactNode, useEffect, useMemo, useState } from "react";

const nav = [
  { href: "/dashboard", label: "Dashboard", icon: BarChart3 },
  { href: "/conexao", label: "Conexão", icon: QrCode },
  { href: "/mensagem", label: "Mensagem", icon: MessageCircle },
  { href: "/grupos", label: "Grupos", icon: Users },
  { href: "/lotes", label: "Lotes", icon: Clipboard },
  { href: "/envios", label: "Envios", icon: Send },
  { href: "/envios-grupo", label: "Envios em grupo", icon: Inbox },
  { href: "/incertos", label: "Incertos", icon: HelpCircle },
  { href: "/configuracoes", label: "Configurações", icon: Cog }
];

export function AppShell({ children, title, subtitle }: { children: ReactNode; title: string; subtitle?: string }) {
  const pathname = usePathname();
  return (
    <div className="min-h-screen lg:flex">
      <aside className="hidden w-72 border-r border-line bg-panel/90 px-4 py-5 lg:block">
        <div className="mb-8 flex items-center gap-3 px-2">
          <div className="grid h-10 w-10 place-items-center rounded-lg bg-accent text-white"><Shield size={20} /></div>
          <div>
            <div className="text-sm font-semibold text-ink">ElevaZap Ops</div>
            <div className="text-xs text-muted">Operação interna</div>
          </div>
        </div>
        <nav className="space-y-1">
          {nav.map((item) => {
            const active = pathname === item.href;
            const Icon = item.icon;
            return (
              <Link key={item.href} href={item.href} className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition ${active ? "bg-accent text-white shadow-soft" : "text-muted hover:bg-wash hover:text-ink"}`}>
                <Icon size={18} />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-10 border-b border-line bg-wash/85 px-4 py-4 backdrop-blur lg:px-8">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h1 className="text-xl font-semibold tracking-normal text-ink">{title}</h1>
              {subtitle ? <p className="mt-1 text-sm text-muted">{subtitle}</p> : null}
            </div>
            <form action="/api/auth/logout" method="post">
              <button className="inline-flex h-10 items-center gap-2 rounded-lg border border-line bg-panel px-3 text-sm text-muted hover:text-ink" title="Sair">
                <LogOut size={16} /> <span className="hidden sm:inline">Sair</span>
              </button>
            </form>
          </div>
          <nav className="mt-4 flex gap-2 overflow-x-auto lg:hidden">
            {nav.map((item) => {
              const active = pathname === item.href;
              const Icon = item.icon;
              return (
                <Link key={item.href} href={item.href} className={`inline-flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-sm ${active ? "bg-accent text-white" : "bg-panel text-muted"}`}>
                  <Icon size={16} /> {item.label}
                </Link>
              );
            })}
          </nav>
        </header>
        <main className="flex-1 px-4 py-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}

export function StatusBadge({ status }: { status?: string | null }) {
  const s = status || "sem dados";
  const cls = {
    sucesso: "bg-emerald-50 text-emerald-700 border-emerald-200",
    connected: "bg-emerald-50 text-emerald-700 border-emerald-200",
    erro: "bg-red-50 text-red-700 border-red-200",
    disconnected: "bg-red-50 text-red-700 border-red-200",
    incerto: "bg-amber-50 text-amber-700 border-amber-200",
    pausado: "bg-slate-100 text-slate-700 border-slate-200",
    cancelado: "bg-slate-100 text-slate-700 border-slate-200",
    processando: "bg-blue-50 text-blue-700 border-blue-200",
    enfileirado: "bg-indigo-50 text-indigo-700 border-indigo-200",
    pendente: "bg-zinc-50 text-zinc-700 border-zinc-200"
  } as Record<string, string>;
  return <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${cls[s] || cls.pendente}`}>{s}</span>;
}

export function PriorityBadge({ priority }: { priority: "alta" | "normal" }) {
  return <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${priority === "alta" ? "bg-coral/10 text-coral" : "bg-accent/10 text-accent"}`}>{priority}</span>;
}

export function StatCard({ label, value, icon }: { label: string; value: ReactNode; icon?: ReactNode }) {
  return <div className="rounded-lg border border-line bg-panel p-5 shadow-soft"><div className="flex items-center justify-between gap-3"><div className="text-sm text-muted">{label}</div><div className="text-muted">{icon}</div></div><div className="mt-3 text-2xl font-semibold text-ink">{value}</div></div>;
}

export function DataTable({ columns, rows }: { columns: string[]; rows: ReactNode[][] }) {
  if (!rows.length) return <EmptyState title="Sem dados" description="Nada encontrado para os filtros atuais." />;
  return <div className="overflow-hidden rounded-lg border border-line bg-panel shadow-soft"><div className="overflow-x-auto"><table className="min-w-full text-left text-sm"><thead className="bg-wash text-xs uppercase text-muted"><tr>{columns.map((c) => <th key={c} className="px-4 py-3 font-medium">{c}</th>)}</tr></thead><tbody className="divide-y divide-line">{rows.map((row, i) => <tr key={i} className="hover:bg-wash/60">{row.map((cell, j) => <td key={j} className="px-4 py-3 align-top">{cell}</td>)}</tr>)}</tbody></table></div></div>;
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

export function ConfirmModal({ open, title, children, onCancel, onConfirm }: { open: boolean; title: string; children: ReactNode; onCancel: () => void; onConfirm: () => void }) {
  if (!open) return null;
  return <div className="fixed inset-0 z-50 grid place-items-center bg-ink/30 p-4"><div className="w-full max-w-md rounded-lg bg-panel p-5 shadow-soft"><h3 className="font-semibold text-ink">{title}</h3><div className="mt-2 text-sm text-muted">{children}</div><div className="mt-5 flex justify-end gap-2"><button className="rounded-lg border border-line px-4 py-2 text-sm" onClick={onCancel}>Voltar</button><button className="rounded-lg bg-accent px-4 py-2 text-sm text-white" onClick={onConfirm}>Confirmar</button></div></div></div>;
}

export function Toast({ message }: { message: string }) {
  if (!message) return null;
  return <div className="fixed bottom-4 right-4 rounded-lg bg-ink px-4 py-3 text-sm text-white shadow-soft">{message}</div>;
}

export function ConnectionStatusCard({ status, qr }: { status?: string; qr?: string }) {
  return <div className="rounded-lg border border-line bg-panel p-6 shadow-soft"><div className="flex items-center justify-between"><div><div className="text-sm text-muted">WhatsApp</div><div className="mt-1 text-lg font-semibold text-ink">{status || "desconectado"}</div></div><StatusBadge status={status} /></div>{qr ? <div className="mt-6 rounded-lg bg-wash p-5 text-center font-mono text-xs break-all">{qr}</div> : null}</div>;
}

export function UncertainStatusCard({ critical, item, onAction }: { critical?: boolean; item: any; onAction?: (action: string, item: any) => void }) {
  return <div className={`rounded-lg border p-4 ${critical ? "border-red-200 bg-red-50" : "border-amber-200 bg-amber-50"}`}><div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><div className="font-medium text-ink">{item.nome || item.nome_grupo || "Item incerto"}</div><div className="mt-1 text-sm text-muted">{item.erro || "Aguardando resolução manual."}</div></div><div className="flex gap-2"><button className="rounded-lg bg-accent px-3 py-2 text-sm text-white" onClick={() => onAction?.("success", item)}><Check size={15} /></button><button className="rounded-lg bg-coral px-3 py-2 text-sm text-white" onClick={() => onAction?.("error", item)}><X size={15} /></button><button className="rounded-lg border border-line bg-panel px-3 py-2 text-sm" onClick={() => onAction?.("retry", item)}><RefreshCw size={15} /></button></div></div></div>;
}

export function SearchInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <div className="relative"><Search className="pointer-events-none absolute left-3 top-3 text-muted" size={16} /><input {...props} className="focus-ring h-11 w-full rounded-lg border border-line bg-panel pl-9 pr-3 text-sm" /></div>;
}

export function ActionButton({ children, icon, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { icon?: ReactNode }) {
  return <button {...props} className={`inline-flex h-10 items-center justify-center gap-2 rounded-lg px-4 text-sm font-medium transition disabled:opacity-50 ${props.className || "bg-accent text-white hover:bg-accent/90"}`}>{icon}{children}</button>;
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
