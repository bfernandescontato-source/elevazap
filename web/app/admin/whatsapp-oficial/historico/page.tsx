"use client";
import { useCallback, useEffect, useState } from "react";
import { ActionButton, AppShell, ConfirmModal, DataTable, EmptyState, ErrorState, LoadingState } from "@/components/ui";

type Event = { id: string; created_at: string; event_type: string; product_name: string | null; customer_name: string | null; status: string; error: string | null };
type Message = { id: string; created_at: string; phone: string; template_name: string | null; status: string; error: string | null; source_type: string; automation_reply_state: string | null };
const statusLabels: Record<string, string> = { accepted: "Aceita pela Meta", sent: "Enviada", delivered: "Entregue", read: "Lida", failed: "Falhou", received: "Recebido", ignored: "Ignorado", processed: "Processado", processing: "Processando", waiting: "Aguarda clique", sending: "Enviando resposta" };
export default function OfficialHistoryPage() {
  const [tab, setTab] = useState("messages"), [events, setEvents] = useState<Event[]>([]), [messages, setMessages] = useState<Message[]>([]), [error, setError] = useState(""), [loading, setLoading] = useState(true), [target, setTarget] = useState<Event | null>(null), [sending, setSending] = useState(false);
  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const [m, e] = await Promise.all([fetch("/api/admin/official/messages"), fetch("/api/admin/official/events")]);
      if (!m.ok || !e.ok) throw new Error("Não foi possível carregar o histórico.");
      const [md, ed] = await Promise.all([m.json(), e.json()]); setMessages(md.messages || []); setEvents(ed.events || []);
    } catch (e) { setError(e instanceof Error ? e.message : "Falha ao carregar."); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);
  async function reprocess() {
    if (!target || sending) return; setSending(true);
    try {
      const response = await fetch(`/api/admin/official/events/${target.id}/reprocess`, { method: "POST" });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || "Falha ao reprocessar.");
      setTarget(null); await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Falha ao reprocessar."); }
    finally { setSending(false); }
  }
  return <AppShell title="Histórico da API" subtitle="Acompanhe entregas, respostas e eventos de compra sem misturar com a configuração."><div className="space-y-5"><div className="flex flex-wrap items-center justify-between gap-3"><div className="flex gap-2">{[["messages", "Mensagens"], ["events", "Eventos da Hubla"]].map(([key, label]) => <button type="button" key={key} onClick={() => setTab(key)} className={`rounded-xl px-4 py-2 text-sm ${tab === key ? "bg-black text-white" : "border border-line bg-white"}`}>{label}</button>)}</div><ActionButton onClick={load} disabled={loading}>Atualizar</ActionButton></div>{error ? <ErrorState message={error} /> : null}{loading ? <LoadingState /> : tab === "messages" ? messages.length ? <DataTable columns={["Data", "Telefone", "Mensagem", "Status", "Próxima mensagem", "Erro"]} rows={messages.map(m => [new Date(m.created_at).toLocaleString("pt-BR"), m.phone, m.template_name || "Resposta após clique", statusLabels[m.status] || m.status, m.automation_reply_state ? statusLabels[m.automation_reply_state] || m.automation_reply_state : "—", m.error || "—"])} /> : <EmptyState title="Nenhuma mensagem" description="Os envios aparecerão aqui." /> : events.length ? <DataTable columns={["Data", "Evento", "Produto", "Cliente", "Status", "Erro", "Ação"]} rows={events.map(e => [new Date(e.created_at).toLocaleString("pt-BR"), e.event_type, e.product_name || "—", e.customer_name || "—", statusLabels[e.status] || e.status, e.error || "—", ["failed", "ignored"].includes(e.status) ? <button key={e.id} className="text-sm underline" onClick={() => setTarget(e)}>Reprocessar</button> : "—"])} /> : <EmptyState title="Nenhum evento" description="Configure o webhook da Hubla em Configurações da API." />}</div><ConfirmModal open={Boolean(target)} title="Reprocessar compra?" onCancel={() => setTarget(null)} onConfirm={reprocess} loading={sending} confirmLabel="Reprocessar">Isso pode enviar uma mensagem real para {target?.customer_name || "o cliente"}, usando a automação ativa do produto.</ConfirmModal></AppShell>;
}
