"use client";

import {
  ActionButton, AlertCard, AppShell, ConnectionStatusCard, EmptyState, ErrorState, LoadingState, Toast
} from "@/components/ui";
import {
  BookOpen, Bot, Check, ChevronRight, Inbox, MessageSquare, Pause, Play,
  Plus, QrCode, RefreshCw, Send, Trash2, User, X, DollarSign
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

// ─── Types ───────────────────────────────────────────────────────────────────

type Agent = {
  id: string; name: string; enabled: boolean; system_prompt: string;
  model: string; temperature: number; max_history: number;
  aggregation_seconds: number; human_takeover_minutes: number;
  business_hours: any; fallback_message: string; whatsapp_session_id: string;
};
type KBEntry = { id: string; title: string; content: string };
type Conversation = {
  id: string; contact_jid: string; contact_name: string;
  status: string; last_message_at: string; ai_paused_until: string | null;
};
type Message = {
  id: string; direction: string; sender: string; content: string; created_at: string;
};
type RefundRequest = {
  id: string; contact_jid: string; elevapay_order_id: string; amount: number | null; reason: string;
  status: string; created_at: string; customer_name?: string | null; customer_email?: string | null;
  support_conversation: { contact_name: string; contact_jid: string } | null;
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

const fmt = (s: string) =>
  new Date(s).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

const statusLabel: Record<string, string> = {
  open: "Aberta", ai_active: "IA ativa", human_active: "Humano", closed: "Fechada"
};
const statusColor: Record<string, string> = {
  open: "bg-zinc-100 text-zinc-700",
  ai_active: "bg-blue-50 text-blue-700",
  human_active: "bg-amber-50 text-amber-700",
  closed: "bg-slate-100 text-slate-500"
};

// ─── Tab management ───────────────────────────────────────────────────────────

type Tab = "config" | "inbox" | "kb" | "refunds";

// ─── Main page ────────────────────────────────────────────────────────────────

export default function SuportePage() {
  const [tab, setTab] = useState<Tab>("config");
  const [toast, setToast] = useState("");
  const notify = (msg: string) => { setToast(msg); setTimeout(() => setToast(""), 3000); };

  return (
    <AppShell title="Suporte via IA" subtitle="Atendimento automático no WhatsApp">
      <div className="space-y-5">
        {/* Tab bar */}
        <div className="flex gap-1 rounded-lg border border-line bg-wash p-1">
          {([
            ["config", "Configuração", <Bot size={15} />],
            ["inbox", "Caixa de entrada", <Inbox size={15} />],
            ["kb", "Base de conhecimento", <BookOpen size={15} />],
            ["refunds", "Reembolsos", <DollarSign size={15} />]
          ] as [Tab, string, React.ReactNode][]).map(([id, label, icon]) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition ${tab === id ? "bg-panel shadow-soft text-ink" : "text-muted hover:text-ink"}`}
            >
              {icon}{label}
            </button>
          ))}
        </div>

        {tab === "config" && <ConfigTab notify={notify} />}
        {tab === "inbox" && <InboxTab notify={notify} />}
        {tab === "kb" && <KnowledgeBaseTab notify={notify} />}
        {tab === "refunds" && <RefundsTab notify={notify} />}

        <Toast message={toast} />
      </div>
    </AppShell>
  );
}

// ─── Config Tab ───────────────────────────────────────────────────────────────

function ConfigTab({ notify }: { notify: (m: string) => void }) {
  const [agent, setAgent] = useState<Agent | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [session, setSession] = useState<{ status: string; qr: string; llmReady?: boolean; agentEnabled?: boolean }>({ status: "disconnected", qr: "" });
  const [saving, setSaving] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadAgent = useCallback(async () => {
    try {
      const res = await fetch("/api/support/agent");
      if (!res.ok) throw new Error("Falha ao carregar agente.");
      const { agent } = await res.json();
      setAgent(agent);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadSession = useCallback(async () => {
    const res = await fetch("/api/support/status").catch(() => null);
    if (res?.ok) {
      const data = await res.json();
      setSession(data);
    }
  }, []);

  useEffect(() => {
    loadAgent();
    loadSession();
    pollRef.current = setInterval(loadSession, 3000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [loadAgent, loadSession]);

  async function save() {
    if (!agent) return;
    setSaving(true);
    try {
      const res = await fetch("/api/support/agent", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(agent)
      });
      if (!res.ok) throw new Error("Falha ao salvar.");
      notify("Configuração salva.");
      loadSession();
    } catch (e: any) {
      notify(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function connectNew() {
    setConnecting(true);
    try {
      const res = await fetch("/api/support/status", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({}) });
      if (!res.ok) throw new Error((await res.json()).error || "Falha ao iniciar sessão.");
      notify("Iniciando sessão. Aguarde o QR code.");
      await loadSession();
    } catch (e: any) {
      notify(e.message);
    } finally {
      setConnecting(false);
    }
  }

  async function disconnect() {
    await fetch("/api/support/status", { method: "DELETE" });
    notify("Sessão desconectada.");
    await loadSession();
  }

  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} />;
  if (!agent) return <ErrorState message="Agente não encontrado." />;

  const isConnected = session.status === "connected";
  const iaReady = isConnected && agent.enabled && session.llmReady !== false;

  return (
    <div className="space-y-5">
      {/* Session card */}
      <div className="rounded-lg border border-line bg-panel p-5 shadow-soft">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-semibold text-ink">Número de suporte</h2>
          <span className={`rounded-full border px-2.5 py-1 text-xs font-medium ${isConnected ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-red-200 bg-red-50 text-red-700"}`}>
            {session.status}
          </span>
        </div>
        {session.qr && (
          <div className="mb-4 flex justify-center rounded-lg bg-wash p-5">
            <img src={session.qr} alt="QR Code" className="h-64 w-64 rounded-lg bg-white p-2" />
          </div>
        )}
        {!isConnected && !session.qr && (
          <AlertCard title="Nenhum número conectado">
            Conecte um número dedicado ao suporte escaneando um QR code.
          </AlertCard>
        )}
        <div className="mt-4 flex gap-2">
          <ActionButton icon={<QrCode size={16} />} onClick={connectNew} disabled={connecting}>
            {connecting ? "Aguarde..." : "Conectar número via QR"}
          </ActionButton>
          {isConnected && (
            <ActionButton icon={<X size={16} />} className="border border-line bg-panel text-ink" onClick={disconnect}>
              Desconectar
            </ActionButton>
          )}
        </div>
        <div className={`mt-4 rounded-lg border p-3 text-sm ${iaReady ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-amber-200 bg-amber-50 text-amber-800"}`}>
          {iaReady ? "IA pronta para responder." : !isConnected ? "Conecte o número de suporte para a IA responder." : !agent.enabled ? "Ative o agente e salve a configuração." : "OPENAI_API_KEY não configurada no Railway do whatsapp-service."}
        </div>
      </div>

      {/* Agent toggle */}
      <div className="rounded-lg border border-line bg-panel p-5 shadow-soft">
        <div className="flex items-center justify-between">
          <div>
            <div className="font-semibold text-ink">Agente ativo</div>
            <div className="text-sm text-muted">Ativar resposta automática por IA</div>
          </div>
          <button
            onClick={() => setAgent({ ...agent, enabled: !agent.enabled })}
            className={`relative h-7 w-12 rounded-full transition ${agent.enabled ? "bg-accent" : "bg-line"}`}
          >
            <span className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-all ${agent.enabled ? "left-6" : "left-1"}`} />
          </button>
        </div>
      </div>

      {/* System prompt */}
      <div className="rounded-lg border border-line bg-panel p-5 shadow-soft space-y-4">
        <h2 className="font-semibold text-ink">Configurações da IA</h2>

        <div>
          <label className="mb-1.5 block text-sm font-medium text-ink">Persona / Prompt do sistema</label>
          <textarea
            rows={6}
            className="focus-ring w-full rounded-lg border border-line bg-wash p-3 text-sm"
            placeholder="Você é um assistente de suporte da [Empresa]. Seja cordial, objetivo e resolva problemas com empatia..."
            value={agent.system_prompt}
            onChange={(e) => setAgent({ ...agent, system_prompt: e.target.value })}
          />
        </div>

        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-muted">Modelo</label>
            <select
              className="focus-ring h-10 w-full rounded-lg border border-line bg-panel px-3 text-sm"
              value={agent.model}
              onChange={(e) => setAgent({ ...agent, model: e.target.value })}
            >
              <option value="gpt-4o-mini">gpt-4o-mini (econômico)</option>
              <option value="gpt-4o">gpt-4o (qualidade)</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted">Temperatura</label>
            <input type="number" min="0" max="2" step="0.1"
              className="focus-ring h-10 w-full rounded-lg border border-line bg-panel px-3 text-sm"
              value={agent.temperature}
              onChange={(e) => setAgent({ ...agent, temperature: Number(e.target.value) })}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted">Histórico máximo</label>
            <input type="number" min="5" max="100"
              className="focus-ring h-10 w-full rounded-lg border border-line bg-panel px-3 text-sm"
              value={agent.max_history}
              onChange={(e) => setAgent({ ...agent, max_history: Number(e.target.value) })}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted">Janela de agregação (s)</label>
            <input type="number" min="1" max="60"
              className="focus-ring h-10 w-full rounded-lg border border-line bg-panel px-3 text-sm"
              value={agent.aggregation_seconds}
              onChange={(e) => setAgent({ ...agent, aggregation_seconds: Number(e.target.value) })}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted">Pausa após takeover (min)</label>
            <input type="number" min="5"
              className="focus-ring h-10 w-full rounded-lg border border-line bg-panel px-3 text-sm"
              value={agent.human_takeover_minutes}
              onChange={(e) => setAgent({ ...agent, human_takeover_minutes: Number(e.target.value) })}
            />
          </div>
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-medium text-ink">Mensagem fora do horário</label>
          <input
            className="focus-ring h-10 w-full rounded-lg border border-line bg-panel px-3 text-sm"
            value={agent.fallback_message}
            onChange={(e) => setAgent({ ...agent, fallback_message: e.target.value })}
          />
        </div>

        <ActionButton onClick={save} disabled={saving}>
          {saving ? "Salvando..." : "Salvar configuração"}
        </ActionButton>
      </div>
    </div>
  );
}

// ─── Inbox Tab ────────────────────────────────────────────────────────────────

function InboxTab({ notify }: { notify: (m: string) => void }) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [conv, setConv] = useState<Conversation | null>(null);
  const [replyText, setReplyText] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const loadConversations = useCallback(async () => {
    const res = await fetch("/api/support/conversations");
    if (res.ok) { const d = await res.json(); setConversations(d.conversations || []); }
    setLoading(false);
  }, []);

  const loadConversation = useCallback(async (id: string) => {
    const res = await fetch(`/api/support/conversations/${id}`);
    if (res.ok) {
      const d = await res.json();
      setMessages(d.messages || []);
      setConv(d.conversation || null);
    }
  }, []);

  useEffect(() => {
    loadConversations();
    const id = setInterval(loadConversations, 5000);
    return () => clearInterval(id);
  }, [loadConversations]);

  useEffect(() => {
    if (selected) {
      loadConversation(selected);
      const id = setInterval(() => loadConversation(selected), 3000);
      return () => clearInterval(id);
    }
  }, [selected, loadConversation]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function takeover() {
    if (!conv) return;
    await fetch(`/api/support/conversations/${conv.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "human_active" })
    });
    notify("Você assumiu a conversa.");
    loadConversation(conv.id);
  }

  async function handBack() {
    if (!conv) return;
    await fetch(`/api/support/conversations/${conv.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "ai_active", ai_paused_until: null })
    });
    notify("Conversa devolvida para a IA.");
    loadConversation(conv.id);
  }

  async function sendReply() {
    if (!replyText.trim() || !conv) return;
    setSending(true);
    try {
      const res = await fetch(`/api/support/conversations/${conv.id}/reply`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: replyText.trim() })
      });
      if (!res.ok) throw new Error((await res.json()).error || "Falha ao enviar.");
      setReplyText("");
      await loadConversation(conv.id);
    } catch (e: any) {
      notify(e.message);
    } finally {
      setSending(false);
    }
  }

  if (loading) return <LoadingState />;

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      {/* Conversation list */}
      <div className="rounded-lg border border-line bg-panel shadow-soft lg:col-span-1">
        <div className="border-b border-line px-4 py-3 text-sm font-semibold text-ink">Conversas</div>
        {conversations.length === 0 ? (
          <div className="p-4 text-sm text-muted">Nenhuma conversa ainda.</div>
        ) : (
          <div className="divide-y divide-line">
            {conversations.map((c) => (
              <button
                key={c.id}
                onClick={() => setSelected(c.id)}
                className={`w-full px-4 py-3 text-left transition hover:bg-wash ${selected === c.id ? "bg-wash" : ""}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-medium text-sm text-ink">{c.contact_name || c.contact_jid}</span>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs ${statusColor[c.status] || "bg-zinc-100 text-zinc-700"}`}>
                    {statusLabel[c.status] || c.status}
                  </span>
                </div>
                <div className="mt-0.5 text-xs text-muted">{fmt(c.last_message_at)}</div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Message thread */}
      <div className="flex flex-col rounded-lg border border-line bg-panel shadow-soft lg:col-span-2">
        {!selected || !conv ? (
          <div className="grid flex-1 place-items-center p-8 text-sm text-muted">
            Selecione uma conversa para ver o histórico.
          </div>
        ) : (
          <>
            {/* Header */}
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <div>
                <div className="font-semibold text-ink">{conv.contact_name || conv.contact_jid}</div>
                <div className={`mt-0.5 inline-block rounded-full px-2 py-0.5 text-xs ${statusColor[conv.status]}`}>
                  {statusLabel[conv.status]}
                </div>
              </div>
              <div className="flex gap-2">
                {conv.status !== "human_active" ? (
                  <ActionButton icon={<User size={14} />} className="border border-line bg-panel text-ink text-xs px-3 h-8" onClick={takeover}>
                    Assumir
                  </ActionButton>
                ) : (
                  <ActionButton icon={<Bot size={14} />} className="border border-accent text-accent bg-panel text-xs px-3 h-8" onClick={handBack}>
                    Devolver à IA
                  </ActionButton>
                )}
              </div>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3" style={{ maxHeight: "400px" }}>
              {messages.map((m) => {
                const isOut = m.direction === "out";
                const label = m.sender === "ai" ? "IA" : m.sender === "human" ? "Você" : "";
                return (
                  <div key={m.id} className={`flex ${isOut ? "justify-end" : "justify-start"}`}>
                    <div className={`max-w-[75%] rounded-2xl px-3.5 py-2.5 text-sm ${isOut ? "bg-accent text-white" : "bg-wash text-ink"}`}>
                      {isOut && label && <div className="mb-1 text-xs opacity-70">{label}</div>}
                      <div className="whitespace-pre-wrap">{m.content}</div>
                      <div className={`mt-1 text-right text-[10px] ${isOut ? "opacity-60" : "text-muted"}`}>
                        {fmt(m.created_at)}
                      </div>
                    </div>
                  </div>
                );
              })}
              <div ref={bottomRef} />
            </div>

            {/* Reply box */}
            {conv.status === "human_active" && (
              <div className="border-t border-line p-3 flex gap-2">
                <input
                  className="focus-ring flex-1 rounded-lg border border-line bg-wash px-3 text-sm h-10"
                  placeholder="Escreva uma resposta..."
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendReply(); } }}
                />
                <ActionButton icon={<Send size={15} />} onClick={sendReply} disabled={sending || !replyText.trim()}>
                  {sending ? "..." : "Enviar"}
                </ActionButton>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ─── Knowledge Base Tab ───────────────────────────────────────────────────────

function KnowledgeBaseTab({ notify }: { notify: (m: string) => void }) {
  const [entries, setEntries] = useState<KBEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ title: "", content: "" });
  const [editId, setEditId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch("/api/support/kb");
    if (res.ok) { const d = await res.json(); setEntries(d.kb || []); }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function save() {
    if (!form.title.trim() || !form.content.trim()) { notify("Título e conteúdo obrigatórios."); return; }
    setSaving(true);
    try {
      const url = editId ? `/api/support/kb/${editId}` : "/api/support/kb";
      const method = editId ? "PUT" : "POST";
      const res = await fetch(url, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(form) });
      if (!res.ok) throw new Error("Falha ao salvar.");
      setForm({ title: "", content: "" });
      setEditId(null);
      notify(editId ? "Entrada atualizada." : "Entrada criada.");
      load();
    } catch (e: any) {
      notify(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    await fetch(`/api/support/kb/${id}`, { method: "DELETE" });
    notify("Entrada removida.");
    load();
  }

  function startEdit(e: KBEntry) {
    setEditId(e.id);
    setForm({ title: e.title, content: e.content });
  }

  function cancelEdit() { setEditId(null); setForm({ title: "", content: "" }); }

  if (loading) return <LoadingState />;

  return (
    <div className="space-y-5">
      {/* Form */}
      <div className="rounded-lg border border-line bg-panel p-5 shadow-soft space-y-3">
        <h2 className="font-semibold text-ink">{editId ? "Editar entrada" : "Nova entrada"}</h2>
        <input
          className="focus-ring h-10 w-full rounded-lg border border-line bg-wash px-3 text-sm"
          placeholder="Título (ex: Política de Reembolso)"
          value={form.title}
          onChange={(e) => setForm({ ...form, title: e.target.value })}
        />
        <textarea
          rows={5}
          className="focus-ring w-full rounded-lg border border-line bg-wash p-3 text-sm"
          placeholder="Conteúdo da base de conhecimento..."
          value={form.content}
          onChange={(e) => setForm({ ...form, content: e.target.value })}
        />
        <div className="flex gap-2">
          <ActionButton icon={editId ? <Check size={15} /> : <Plus size={15} />} onClick={save} disabled={saving}>
            {saving ? "Salvando..." : editId ? "Atualizar" : "Adicionar"}
          </ActionButton>
          {editId && (
            <ActionButton onClick={cancelEdit} className="border border-line bg-panel text-ink">Cancelar</ActionButton>
          )}
        </div>
      </div>

      {/* List */}
      {entries.length === 0 ? (
        <EmptyState title="Base de conhecimento vazia" description="Adicione FAQs, políticas ou informações que a IA pode consultar." />
      ) : (
        <div className="space-y-3">
          {entries.map((e) => (
            <div key={e.id} className="rounded-lg border border-line bg-panel p-4 shadow-soft">
              <div className="flex items-start justify-between gap-3">
                <div className="font-medium text-ink">{e.title}</div>
                <div className="flex shrink-0 gap-1">
                  <button onClick={() => startEdit(e)} className="rounded-lg border border-line p-1.5 text-muted hover:text-ink">
                    <MessageSquare size={14} />
                  </button>
                  <button onClick={() => remove(e.id)} className="rounded-lg border border-line p-1.5 text-muted hover:text-red-600">
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
              <p className="mt-2 text-sm text-muted line-clamp-3">{e.content}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Refunds Tab ──────────────────────────────────────────────────────────────

function RefundsTab({ notify }: { notify: (m: string) => void }) {
  const [refunds, setRefunds] = useState<RefundRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/support/refunds");
    if (res.ok) { const d = await res.json(); setRefunds(d.refunds || []); }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function act(id: string, action: "approve" | "reject") {
    setActing(id);
    try {
      const res = await fetch(`/api/support/refunds/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action })
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Falha.");
      notify(action === "approve" ? "Reembolso aprovado e processado." : "Reembolso rejeitado.");
      load();
    } catch (e: any) {
      notify(e.message);
    } finally {
      setActing(null);
    }
  }

  if (loading) return <LoadingState />;

  const refundStatusColor: Record<string, string> = {
    pending: "bg-amber-50 text-amber-700 border-amber-200",
    approved: "bg-emerald-50 text-emerald-700 border-emerald-200",
    processed: "bg-emerald-50 text-emerald-700 border-emerald-200",
    rejected: "bg-red-50 text-red-700 border-red-200"
  };

  return (
    <div className="space-y-4">
      {refunds.length === 0 ? (
        <EmptyState title="Sem solicitações de reembolso" description="Quando a IA abrir uma solicitação, ela aparecerá aqui para aprovação." />
      ) : (
        refunds.map((r) => (
          <div key={r.id} className="rounded-lg border border-line bg-panel p-4 shadow-soft">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-medium text-ink">{r.customer_name || r.support_conversation?.contact_name || r.contact_jid || "—"}</span>
                  <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${refundStatusColor[r.status] || "bg-zinc-100 text-zinc-700 border-zinc-200"}`}>
                    {r.status}
                  </span>
                </div>
                <div className="mt-1 text-sm text-muted">
                  E-mail: <span className="font-mono">{r.customer_email || "—"}</span>
                </div>
                <div className="mt-1 text-sm text-muted">
                  Pedido: <span className="font-mono">{r.elevapay_order_id || "—"}</span>
                  {r.amount != null && <span> · R$ {Number(r.amount).toFixed(2).replace(".", ",")}</span>}
                </div>
                <div className="mt-1 text-sm text-ink">{r.reason}</div>
                <div className="mt-1 text-xs text-muted">{fmt(r.created_at)}</div>
              </div>
              {r.status === "pending" && (
                <div className="flex shrink-0 gap-2">
                  <ActionButton
                    icon={<Check size={15} />}
                    onClick={() => act(r.id, "approve")}
                    disabled={acting === r.id}
                    className="bg-emerald-600 text-white"
                  >
                    Aprovar
                  </ActionButton>
                  <ActionButton
                    icon={<X size={15} />}
                    onClick={() => act(r.id, "reject")}
                    disabled={acting === r.id}
                    className="border border-line bg-panel text-red-600"
                  >
                    Rejeitar
                  </ActionButton>
                </div>
              )}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
