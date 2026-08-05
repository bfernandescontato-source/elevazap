"use client";

import { ActionButton, AlertCard, ConnectionStatusCard, EmptyState, ErrorState, LoadingState } from "@/components/ui";
import { BookOpen, Bot, Check, ChevronRight, DollarSign, Inbox, MessageSquare, Pause, Play, Plus, QrCode, RefreshCw, Send, Trash2, User, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import { fmt, statusColor, statusLabel, type Agent, type Conversation, type KBEntry, type Message, type RefundRequest } from "./support-domain";

export function InboxTab({ notify }: { notify: (m: string) => void }) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [conv, setConv] = useState<Conversation | null>(null);
  const [replyText, setReplyText] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const loadingConversationsRef = useRef(false);
  const loadingConversationRef = useRef(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const loadConversations = useCallback(async () => {
    if (loadingConversationsRef.current) return;
    loadingConversationsRef.current = true;
    try {
    const res = await fetch("/api/support/conversations");
    if (res.ok) { const d = await res.json(); setConversations(d.conversations || []); }
    setLoading(false);
    } finally {
      loadingConversationsRef.current = false;
    }
  }, []);

  const loadConversation = useCallback(async (id: string) => {
    if (loadingConversationRef.current) return;
    loadingConversationRef.current = true;
    try {
    const res = await fetch(`/api/support/conversations/${id}`);
    if (res.ok) {
      const d = await res.json();
      setMessages(d.messages || []);
      setConv(d.conversation || null);
    }
    } finally {
      loadingConversationRef.current = false;
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
