"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ArrowRight, Send, Zap } from "lucide-react";
import { AppShell, EmptyState, ErrorState, LoadingState } from "@/components/ui";

type Dashboard = { automations: number; flows: number; accounts: number; processing: number; recent: { id: string; name: string; status: string; total_rows: number; created_at: string }[] };
const statuses: Record<string, string> = { processing: "Em andamento", paused: "Pausado", completed: "Concluído", failed: "Falhou", draft: "Rascunho" };
export default function OfficialDashboard() {
  const [data, setData] = useState<Dashboard | null>(null), [error, setError] = useState(""), [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    setLoading(true); setError("");
    try { const r = await fetch("/api/admin/official/dashboard", { cache: "no-store" }); const j = await r.json(); if (!r.ok) throw new Error(j.error); setData(j); }
    catch (e) { setError(e instanceof Error ? e.message : "Falha ao carregar."); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);
  return <AppShell title="Painel da API oficial" subtitle="Escolha o que você quer fazer. Cada operação tem seu lugar."><div className="mx-auto max-w-6xl space-y-6">
    <section className="grid gap-5 md:grid-cols-2">
      <Link href="/admin/whatsapp-oficial/automacoes" className="group rounded-2xl bg-neutral-950 p-6 text-white"><Zap className="mb-4 text-emerald-300" size={24} /><h2 className="text-xl font-semibold">Automatizar uma compra</h2><p className="mt-2 text-sm leading-6 text-neutral-300">Produto + evento + mensagem inicial + resposta ao clique. A conversa completa em uma única automação.</p><span className="mt-5 flex items-center gap-2 text-sm font-semibold">Abrir automações <ArrowRight size={16} /></span></Link>
      <Link href="/admin/whatsapp-oficial/disparos" className="group rounded-2xl border border-line bg-white p-6"><Send className="mb-4" size={24} /><h2 className="text-xl font-semibold">Enviar para uma lista</h2><p className="mt-2 text-sm leading-6 text-muted">Escolha a conta, importe os contatos e selecione um fluxo preparado para disparos 1 a 1.</p><span className="mt-5 flex items-center gap-2 text-sm font-semibold">Abrir disparos 1 a 1 <ArrowRight size={16} /></span></Link>
    </section>
    {error ? <ErrorState message={error} /> : null}{loading ? <LoadingState /> : data ? <>
      <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">{[["Contas cadastradas", data.accounts], ["Automações ativas", data.automations], ["Fluxos disponíveis", data.flows], ["Disparos em andamento", data.processing]].map(([label, value]) => <div key={label} className="rounded-2xl border border-line bg-panel p-5"><p className="text-xs text-muted">{label}</p><p className="mt-2 text-3xl font-semibold">{value}</p></div>)}</section>
      <section className="rounded-2xl border border-line bg-panel p-6"><div className="mb-4 flex items-center justify-between gap-3"><h2 className="font-semibold">Últimos disparos</h2><button className="text-sm underline" onClick={load}>Atualizar</button></div>{data.recent.length ? <div className="divide-y divide-line">{data.recent.map(item => <Link key={item.id} href={`/admin/whatsapp-oficial/disparos/${item.id}`} className="flex flex-wrap items-center justify-between gap-3 py-4"><div><p className="text-sm font-medium">{item.name}</p><p className="mt-1 text-xs text-muted">{new Date(item.created_at).toLocaleString("pt-BR")} · {item.total_rows} contatos</p></div><span className="rounded-full bg-wash px-3 py-1 text-xs">{statuses[item.status] || item.status}</span></Link>)}</div> : <EmptyState title="Nenhum disparo ainda" description="Prepare um fluxo e envie sua primeira lista." />}</section>
    </> : null}
    <section className="grid gap-3 sm:grid-cols-3">{[["/contas", "Contas de API", "Conectar números e cuidar das credenciais."], ["/fluxos", "Fluxos para disparos", "Preparar mensagens para usar nas listas."], ["/historico", "Histórico", "Consultar mensagens, compras e falhas."]].map(([path, title, description]) => <Link key={path} href={`/admin/whatsapp-oficial${path}`} className="rounded-xl border border-line bg-panel p-4"><h3 className="text-sm font-semibold">{title}</h3><p className="mt-1 text-xs leading-5 text-muted">{description}</p></Link>)}</section>
    <div className="flex flex-wrap gap-5 text-sm text-muted"><Link className="underline" href="/admin/whatsapp-oficial/operacao">Relatórios detalhados</Link><Link className="underline" href="/admin/whatsapp-oficial/configuracoes">Configurações e webhook da Hubla</Link></div>
  </div></AppShell>;
}
