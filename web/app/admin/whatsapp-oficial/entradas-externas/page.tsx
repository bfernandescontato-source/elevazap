"use client";

import Link from "next/link";
import { ConnectionSelect } from "../connection-select";
import { useEffect, useState } from "react";
import { ActionButton, AlertCard, AppShell, CopyButton, EmptyState, LoadingState, Toast } from "@/components/ui";
import { ArrowLeft, ArrowRight, Pencil, Plus } from "lucide-react";

type Flow = { id: string; name: string; active: boolean };
type ExternalSource = {
  connection_id: string | null;
  id: string; name: string; source_key: string; flow_id: string; fixed_content_name: string | null; active: boolean;
  official_flows: { name: string } | null;
  receivedToday: number; acceptedToday: number; duplicateToday: number; failedToday: number; lastEventAt: string | null;
};

function timeAgo(iso: string | null) {
  if (!iso) return "sem eventos ainda";
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return `há ${seconds}s`;
  if (seconds < 3600) return `há ${Math.floor(seconds / 60)}min`;
  return `há ${Math.floor(seconds / 3600)}h`;
}

export default function EntradasExternasPage() {
  const [sources, setSources] = useState<ExternalSource[]>([]);
  const [flows, setFlows] = useState<Flow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState("");
  const [createdSecret, setCreatedSecret] = useState<{ sourceKey: string; secret: string } | null>(null);

  const [name, setName] = useState("");
  const [sourceKey, setSourceKey] = useState("");
  const [flowId, setFlowId] = useState("");
  const [connectionId, setConnectionId] = useState("legacy");
  const [fixedContentName, setFixedContentName] = useState("");

  async function loadSources() {
    const response = await fetch("/api/admin/official/external-sources", { cache: "no-store" });
    const data = await response.json();
    setSources(data.sources || []);
  }
  async function loadFlows() {
    const response = await fetch("/api/admin/official/flows", { cache: "no-store" });
    const data = await response.json();
    setFlows((data.flows || []).map((flow: any) => ({ id: flow.id, name: flow.name, active: flow.active })));
  }
  useEffect(() => { setLoading(true); Promise.all([loadSources(), loadFlows()]).finally(() => setLoading(false)); }, []);

  function resetForm() {
    setConnectionId("legacy");
    setEditingId(null); setName(""); setSourceKey(""); setFlowId(""); setFixedContentName("");
  }

  function startEdit(source: ExternalSource) {
    setEditingId(source.id);
    setName(source.name);
    setSourceKey(source.source_key);
    setFlowId(source.flow_id);
    setConnectionId(source.connection_id || "legacy");
    setFixedContentName(source.fixed_content_name || "");
    setShowForm(true);
  }

  async function saveSource() {
    if (!name || !sourceKey || !flowId) return;
    setSaving(true);
    try {
      const response = await fetch(editingId ? `/api/admin/official/external-sources/${editingId}` : "/api/admin/official/external-sources", {
        method: editingId ? "PATCH" : "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, sourceKey, flowId, fixedContentName: fixedContentName || null, connectionId })
      });
      const data = await response.json();
      if (!response.ok) { setToast(`Falha: ${data.error || "erro desconhecido"}.`); return; }
      if (!editingId && data.secret) setCreatedSecret({ sourceKey: data.source.source_key, secret: data.secret });
      setToast(editingId ? "Entrada atualizada." : "Entrada criada.");
      setShowForm(false); resetForm(); await loadSources();
    } finally {
      setSaving(false);
      setTimeout(() => setToast(""), 4000);
    }
  }

  async function toggleActive(source: ExternalSource) {
    const response = await fetch(`/api/admin/official/external-sources/${source.id}`, {
      method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ active: !source.active })
    });
    if (response.ok) await loadSources();
  }

  if (loading) return <AppShell title="Entradas externas" subtitle="WhatsApp Oficial"><LoadingState /></AppShell>;

  return <AppShell title="Entradas externas" subtitle="Leads de fora da Disparei (ex: roleta) iniciando um fluxo já existente, em tempo real">
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <Link href="/admin/whatsapp-oficial" className="inline-flex items-center gap-2 text-sm text-muted hover:text-ink"><ArrowLeft size={15} /> Visão geral</Link>
        <Link href="/admin/whatsapp-oficial/fluxos" className="inline-flex items-center gap-2 text-sm font-medium text-ink hover:underline">Fluxos <ArrowRight size={15} /></Link>
      </div>

      {createdSecret ? <AlertCard tone="critical" title="Copie o secret agora — ele não será mostrado de novo">
        <div className="mt-2 space-y-2">
          <div>Source key: <span className="font-mono">{createdSecret.sourceKey}</span></div>
          <div className="flex items-center gap-2">
            <code className="flex-1 truncate rounded-lg border border-line bg-white px-3 py-2 font-mono text-xs">{createdSecret.secret}</code>
            <CopyButton value={createdSecret.secret} />
          </div>
          <button type="button" onClick={() => setCreatedSecret(null)} className="text-xs font-medium text-red-800 underline">Já copiei, fechar</button>
        </div>
      </AlertCard> : null}

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-ink">Entradas externas</h2>
          <ActionButton icon={<Plus size={16} />} onClick={() => { if (showForm) { setShowForm(false); resetForm(); } else { resetForm(); setShowForm(true); } }} className="border border-line bg-white text-ink hover:bg-wash">Nova entrada</ActionButton>
        </div>

        {showForm ? <div className="mb-4 rounded-lg border border-line bg-panel p-6 shadow-soft">
          <h3 className="mb-3 text-sm font-semibold text-ink">{editingId ? "Editar entrada" : "Nova entrada"}</h3>
          <div className="mb-4"><ConnectionSelect value={connectionId} onChange={setConnectionId} disabled={saving} /></div>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="text-sm font-medium text-ink">Nome
              <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Roleta Achadinhos" className="mt-1 h-11 w-full rounded-lg border border-line px-3" />
            </label>
            <label className="text-sm font-medium text-ink">Source key
              <input value={sourceKey} onChange={(event) => setSourceKey(event.target.value)} placeholder="achadinhos-ads-roleta" className="mt-1 h-11 w-full rounded-lg border border-line px-3 font-mono" />
            </label>
            <label className="text-sm font-medium text-ink">Fluxo
              <select value={flowId} onChange={(event) => setFlowId(event.target.value)} className="mt-1 h-11 w-full rounded-lg border border-line bg-white px-3">
                <option value="">Selecione…</option>
                {flows.map((flow) => <option key={flow.id} value={flow.id} disabled={!flow.active}>{flow.name}{flow.active ? "" : " (inativo)"}</option>)}
              </select>
            </label>
            <label className="text-sm font-medium text-ink">Valor fixo para content_name (opcional)
              <input value={fixedContentName} onChange={(event) => setFixedContentName(event.target.value)} placeholder="Material solicitado" className="mt-1 h-11 w-full rounded-lg border border-line px-3" />
            </label>
          </div>
          <p className="mt-2 text-xs text-muted">Se vazio, content_name usa o campo &quot;premio&quot; enviado pelo lead.{editingId ? " Atenção: mudar a source key faz o remetente (ex: Apps Script) parar de encontrar essa entrada até ser atualizado com a nova key." : ""}</p>
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" onClick={() => { setShowForm(false); resetForm(); }} className="rounded-lg border border-line px-4 py-2 text-sm">Cancelar</button>
            <ActionButton disabled={saving || !name || !sourceKey || !flowId} onClick={saveSource}>{saving ? "Salvando…" : editingId ? "Salvar alterações" : "Criar entrada"}</ActionButton>
          </div>
        </div> : null}

        {!sources.length ? <EmptyState title="Nenhuma entrada externa ainda" description="Crie a primeira entrada acima." /> : <div className="space-y-3">
          {sources.map((source) => <div key={source.id} className="rounded-lg border border-line bg-panel p-6 shadow-soft">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-lg font-semibold text-ink">{source.name}</div>
                <div className="mt-1 text-sm text-muted">Origem: <span className="font-mono">{source.source_key}</span> · Fluxo: {source.official_flows?.name || "—"}</div>
              </div>
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => toggleActive(source)} className={`rounded-full border px-2.5 py-1 text-xs font-medium ${source.active ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-line bg-wash text-muted"}`}>{source.active ? "Ativo" : "Inativo"}</button>
                <button type="button" onClick={() => startEdit(source)} className="inline-flex items-center gap-1 rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-ink hover:bg-wash"><Pencil size={13} /> Editar</button>
              </div>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="rounded-lg border border-line bg-wash p-3"><div className="text-xs text-muted">Recebidos hoje</div><div className="text-lg font-semibold text-ink">{source.receivedToday}</div></div>
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3"><div className="text-xs text-emerald-700">Enviados</div><div className="text-lg font-semibold text-emerald-700">{source.acceptedToday}</div></div>
              <div className="rounded-lg border border-line bg-wash p-3"><div className="text-xs text-muted">Duplicados</div><div className="text-lg font-semibold text-ink">{source.duplicateToday}</div></div>
              <div className="rounded-lg border border-red-200 bg-red-50 p-3"><div className="text-xs text-red-700">Falharam</div><div className="text-lg font-semibold text-red-700">{source.failedToday}</div></div>
            </div>
            <div className="mt-3 flex items-center justify-between text-xs text-muted">
              <span>Último evento: {timeAgo(source.lastEventAt)}</span>
              <Link href={`/admin/whatsapp-oficial/entradas-externas/${source.id}`} className="font-medium text-ink hover:underline">Ver logs <ArrowRight size={12} className="inline" /></Link>
            </div>
          </div>)}
        </div>}
      </section>
    </div>
    <Toast message={toast} />
  </AppShell>;
}
