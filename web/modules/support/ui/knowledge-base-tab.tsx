"use client";

import { ActionButton, AlertCard, ConnectionStatusCard, EmptyState, ErrorState, LoadingState } from "@/components/ui";
import { BookOpen, Bot, Check, ChevronRight, DollarSign, Inbox, MessageSquare, Pause, Play, Plus, QrCode, RefreshCw, Send, Trash2, User, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import { fmt, statusColor, statusLabel, type Agent, type Conversation, type KBEntry, type Message, type RefundRequest } from "./support-domain";

export function KnowledgeBaseTab({ notify }: { notify: (m: string) => void }) {
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
