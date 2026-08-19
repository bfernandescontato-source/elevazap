"use client";

import Link from "next/link";
import { ActionButton, AppShell, ConfirmModal, CopyButton, DataTable, EmptyState, ErrorState, LoadingState, Toast } from "@/components/ui";
import { ArrowRight, CheckCircle2, ChevronDown, ChevronRight, Pencil, Plus, RefreshCw, Send, XCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { QuickReplyPanel } from "./quick-reply-panel";

const STATIC_OPTION = "__static__";
const INTERNAL_VARIABLES: { value: string; label: string }[] = [
  { value: "first_name", label: "Primeiro nome" },
  { value: "full_name", label: "Nome completo" },
  { value: "product_name", label: "Nome do produto" },
  { value: "email", label: "E-mail" },
  { value: "phone", label: "Telefone" },
  { value: "amount", label: "Valor" },
  { value: "payment_url", label: "Link de pagamento" },
  { value: "access_url", label: "Link de acesso" },
  { value: STATIC_OPTION, label: "Texto fixo…" }
];

type MappingSlot = { key: string; value: string; staticText: string };

type Status = {
  connected: boolean;
  configStatus: { phoneNumberIdConfigured: boolean; wabaConfigured: boolean; tokenConfigured: boolean; graphVersion: string | null };
  tokenValid: boolean;
  phoneNumber: { accessible: boolean; verifiedName?: string; displayPhoneNumber?: string; qualityRating?: string; error?: string };
  waba: { checked: boolean; accessible: boolean; name?: string; error?: string };
};
type Template = { name: string; category: string; status: string; language: string; variables: { header: number; body: number; buttons: number }; parameterFormat: "POSITIONAL" | "NAMED"; namedVariables: { header: string[]; body: string[] } };
type MessageLog = { id: string; phone: string; template_name: string; template_language: string; status: string; error: string | null; created_at: string };
type HublaEvent = { id: string; event_type: string | null; provider_event_id: string | null; customer_name: string | null; customer_phone: string | null; product_name: string | null; status: string; error: string | null; payload: unknown; created_at: string };
type Automation = { id: string; event_type: string; product_id: string | null; product_name: string | null; template_name: string; template_language: string; variable_mapping: { header?: Record<string, string>; body?: Record<string, string> }; active: boolean };

const ERROR_LABELS: Record<string, string> = {
  META_NOT_CONFIGURED: "Variáveis META_* não configuradas no servidor.",
  META_AUTH_ERROR: "Token de acesso inválido ou expirado.",
  META_SEND_ERROR: "Não foi possível falar com a Meta agora."
};

function CheckRow({ label, ok, detail }: { label: string; ok: boolean; detail?: string }) {
  return <div className="flex items-center gap-2">
    {ok ? <CheckCircle2 className="text-emerald-600" size={16} /> : <XCircle className="text-red-600" size={16} />}
    <span className="text-ink">{label}</span>
    {detail ? <span className="text-muted">— {detail}</span> : null}
  </div>;
}

export default function WhatsappOficialPage() {
  const [status, setStatus] = useState<Status | null>(null);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [templatesError, setTemplatesError] = useState("");
  const [messages, setMessages] = useState<MessageLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [checkingStatus, setCheckingStatus] = useState(false);
  const [phone, setPhone] = useState("");
  const [templateName, setTemplateName] = useState("");
  const [sending, setSending] = useState(false);
  const sendingRef = useRef(false);
  const [toast, setToast] = useState("");
  const [hublaWebhookUrl, setHublaWebhookUrl] = useState<string | null>(null);
  const [hublaEvents, setHublaEvents] = useState<HublaEvent[]>([]);
  const [expandedEventId, setExpandedEventId] = useState<string | null>(null);
  const [automations, setAutomations] = useState<Automation[]>([]);
  const [showAutomationForm, setShowAutomationForm] = useState(false);
  const [editingAutomationId, setEditingAutomationId] = useState<string | null>(null);
  const [savingAutomation, setSavingAutomation] = useState(false);
  const [automationEventType, setAutomationEventType] = useState("");
  const [automationProductId, setAutomationProductId] = useState("");
  const [automationTemplateName, setAutomationTemplateName] = useState("");
  const [automationMapping, setAutomationMapping] = useState<{ header: MappingSlot[]; body: MappingSlot[] }>({ header: [], body: [] });
  const [reprocessTarget, setReprocessTarget] = useState<HublaEvent | null>(null);
  const [reprocessing, setReprocessing] = useState(false);
  const reprocessingRef = useRef(false);

  async function loadStatus() {
    setCheckingStatus(true);
    const response = await fetch("/api/admin/official/status", { cache: "no-store" });
    setStatus(await response.json());
    setCheckingStatus(false);
  }

  async function loadMessages() {
    const response = await fetch("/api/admin/official/messages", { cache: "no-store" });
    const data = await response.json();
    setMessages(data.messages || []);
  }

  async function loadTemplates() {
    const response = await fetch("/api/admin/official/templates", { cache: "no-store" });
    const data = await response.json();
    if (response.ok) { setTemplates(data.templates || []); setTemplatesError(""); }
    else setTemplatesError(data.error || "Falha ao carregar templates.");
  }

  async function loadHubla() {
    const [urlRes, eventsRes] = await Promise.all([
      fetch("/api/admin/official/hubla-webhook-url", { cache: "no-store" }),
      fetch("/api/admin/official/events", { cache: "no-store" })
    ]);
    const urlData = await urlRes.json();
    setHublaWebhookUrl(urlData.url || null);
    const eventsData = await eventsRes.json();
    setHublaEvents(eventsData.events || []);
  }

  async function loadAutomations() {
    const response = await fetch("/api/admin/official/automations", { cache: "no-store" });
    const data = await response.json();
    setAutomations(data.automations || []);
  }

  async function loadAll() {
    setLoading(true);
    await Promise.all([loadStatus(), loadTemplates(), loadMessages(), loadHubla(), loadAutomations()]);
    setLoading(false);
  }

  useEffect(() => { loadAll(); }, []);

  async function sendTest() {
    // Guarda por ref (síncrona, imune a atraso de re-render) além do estado que desabilita o botão.
    if (!phone || !templateName || sendingRef.current) return;
    sendingRef.current = true;
    setSending(true);
    try {
      const response = await fetch("/api/admin/official/test-send", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ phone, templateName })
      });
      const data = await response.json();
      setToast(response.ok ? "Mensagem de teste enviada." : `Falha no envio: ${data.error || "erro desconhecido"}.`);
      await loadMessages();
    } finally {
      sendingRef.current = false;
      setSending(false);
      setTimeout(() => setToast(""), 4000);
    }
  }

  function slotsFor(count: number, names: string[]): MappingSlot[] {
    const keys = names.length ? names : Array.from({ length: count }, (_, index) => String(index + 1));
    return keys.map((key) => ({ key, value: "first_name", staticText: "" }));
  }

  function selectAutomationTemplate(name: string) {
    setAutomationTemplateName(name);
    const template = templates.find((item) => item.name === name);
    if (!template) { setAutomationMapping({ header: [], body: [] }); return; }
    setAutomationMapping({
      header: slotsFor(template.variables.header, template.namedVariables.header),
      body: slotsFor(template.variables.body, template.namedVariables.body)
    });
  }

  function slotsFromMapping(count: number, names: string[], mapping: Record<string, string> = {}): MappingSlot[] {
    return slotsFor(count, names).map((slot) => {
      const mappedValue = mapping[slot.key] || "first_name";
      return mappedValue.startsWith("static:")
        ? { ...slot, value: STATIC_OPTION, staticText: mappedValue.slice("static:".length) }
        : { ...slot, value: mappedValue };
    });
  }

  function resetAutomationForm() {
    setShowAutomationForm(false);
    setEditingAutomationId(null);
    setAutomationEventType("");
    setAutomationProductId("");
    setAutomationTemplateName("");
    setAutomationMapping({ header: [], body: [] });
  }

  function startNewAutomation() {
    resetAutomationForm();
    setShowAutomationForm(true);
  }

  function startEditingAutomation(automation: Automation) {
    const template = templates.find((item) => item.name === automation.template_name && item.language === automation.template_language);
    setEditingAutomationId(automation.id);
    setAutomationEventType(automation.event_type);
    setAutomationProductId(automation.product_id || "");
    setAutomationTemplateName(automation.template_name);
    setAutomationMapping(template ? {
      header: slotsFromMapping(template.variables.header, template.namedVariables.header, automation.variable_mapping.header),
      body: slotsFromMapping(template.variables.body, template.namedVariables.body, automation.variable_mapping.body)
    } : { header: [], body: [] });
    setShowAutomationForm(true);
  }

  function updateSlot(section: "header" | "body", key: string, changes: Partial<MappingSlot>) {
    setAutomationMapping((current) => ({ ...current, [section]: current[section].map((slot) => slot.key === key ? { ...slot, ...changes } : slot) }));
  }

  function slotsToMapping(slots: MappingSlot[]) {
    return Object.fromEntries(slots.map((slot) => [slot.key, slot.value === STATIC_OPTION ? `static:${slot.staticText}` : slot.value]));
  }

  async function saveAutomation() {
    const selectedTemplate = templates.find((item) => item.name === automationTemplateName);
    if (!automationEventType || !selectedTemplate) return;
    setSavingAutomation(true);
    try {
      const variableMapping = {
        ...(automationMapping.header.length ? { header: slotsToMapping(automationMapping.header) } : {}),
        ...(automationMapping.body.length ? { body: slotsToMapping(automationMapping.body) } : {})
      };
      const response = await fetch(editingAutomationId ? `/api/admin/official/automations/${editingAutomationId}` : "/api/admin/official/automations", {
        method: editingAutomationId ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          eventType: automationEventType,
          productId: automationProductId || null,
          templateName: selectedTemplate.name,
          templateLanguage: selectedTemplate.language,
          variableMapping,
          active: true
        })
      });
      const data = await response.json();
      setToast(response.ok ? (editingAutomationId ? "Automação atualizada." : "Automação criada.") : `Falha ao salvar automação: ${data.error || "erro desconhecido"}.`);
      if (response.ok) {
        resetAutomationForm();
        await loadAutomations();
      }
    } finally {
      setSavingAutomation(false);
      setTimeout(() => setToast(""), 4000);
    }
  }

  async function reprocessEvent() {
    if (!reprocessTarget || reprocessingRef.current) return;
    reprocessingRef.current = true;
    setReprocessing(true);
    try {
      const response = await fetch(`/api/admin/official/events/${reprocessTarget.id}/reprocess`, { method: "POST" });
      const data = await response.json();
      setToast(response.ok ? "Evento reenviado." : `Falha ao reenviar: ${data.error || "erro desconhecido"}.`);
      setReprocessTarget(null);
      await Promise.all([loadHubla(), loadMessages()]);
    } finally {
      reprocessingRef.current = false;
      setReprocessing(false);
      setTimeout(() => setToast(""), 4000);
    }
  }

  async function toggleAutomation(automation: Automation) {
    const response = await fetch(`/api/admin/official/automations/${automation.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ active: !automation.active })
    });
    if (response.ok) await loadAutomations();
  }

  const selectedAutomationTemplate = templates.find((item) => item.name === automationTemplateName);
  const approvedTemplates = templates.filter((template) => template.status === "APPROVED");
  const otherTemplates = templates.filter((template) => template.status !== "APPROVED");

  if (loading) return <AppShell title="WhatsApp Oficial" subtitle="Integração administrativa com a WhatsApp Cloud API"><LoadingState /></AppShell>;

  return <AppShell title="WhatsApp Oficial" subtitle="Integração administrativa com a WhatsApp Cloud API oficial da Meta — uso restrito ao administrador">
    <div className="space-y-6">
      <div className="flex flex-wrap gap-4">
        <Link href="/admin/whatsapp-oficial/fluxos" className="inline-flex items-center gap-2 text-sm font-medium text-ink hover:underline">Fluxos <ArrowRight size={15} /></Link>
        <Link href="/admin/whatsapp-oficial/entradas-externas" className="inline-flex items-center gap-2 text-sm font-medium text-ink hover:underline">Entradas externas <ArrowRight size={15} /></Link>
      </div>

      <section className="rounded-lg border border-line bg-panel p-6 shadow-soft">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="text-sm text-muted">Status da conexão</div>
            <div className="mt-1 flex items-center gap-2 text-lg font-semibold text-ink">
              {status?.connected ? <CheckCircle2 className="text-emerald-600" size={20} /> : <XCircle className="text-red-600" size={20} />}
              {status?.connected ? "Conectado" : "Erro de conexão"}
            </div>
          </div>
          <ActionButton icon={<RefreshCw size={16} className={checkingStatus ? "animate-spin" : ""} />} disabled={checkingStatus} className="border border-line bg-white text-ink hover:bg-wash" onClick={loadStatus}>Testar conexão</ActionButton>
        </div>
        {status ? <div className="mt-4 space-y-2 text-sm">
          <CheckRow label="Token de acesso válido" ok={status.tokenValid} detail={!status.tokenValid ? "verifique META_ACCESS_TOKEN" : undefined} />
          <CheckRow label="Phone Number ID acessível" ok={status.phoneNumber.accessible} detail={status.phoneNumber.accessible ? [status.phoneNumber.displayPhoneNumber, status.phoneNumber.verifiedName].filter(Boolean).join(" · ") : ERROR_LABELS[status.phoneNumber.error || ""] || status.phoneNumber.error} />
          <CheckRow label="WABA acessível" ok={status.waba.checked && status.waba.accessible} detail={!status.waba.checked ? "META_WABA_ID não configurado" : status.waba.accessible ? status.waba.name : ERROR_LABELS[status.waba.error || ""] || status.waba.error} />
        </div> : null}
        <div className="mt-4 text-sm text-muted">Graph API: <strong className="text-ink">{status?.configStatus.graphVersion || "—"}</strong></div>
      </section>

      <section className="rounded-lg border border-line bg-panel p-6 shadow-soft">
        <h2 className="text-lg font-semibold text-ink">Enviar mensagem de teste</h2>
        <p className="mt-1 text-sm text-muted">Envia um template aprovado diretamente pela WhatsApp Cloud API. Use um template simples para o primeiro teste.</p>
        {templatesError ? <div className="mt-4"><ErrorState message={templatesError} /></div> : null}
        <div className="mt-4 grid gap-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <label className="text-sm font-medium text-ink">Telefone
            <input value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="+55 19 99999-9999" className="mt-1 h-11 w-full rounded-lg border border-line px-3" />
          </label>
          <label className="text-sm font-medium text-ink">Template
            <select value={templateName} onChange={(event) => setTemplateName(event.target.value)} className="mt-1 h-11 w-full rounded-lg border border-line bg-white px-3">
              <option value="">Selecione…</option>
              {approvedTemplates.map((template) => <option key={`${template.name}-${template.language}`} value={template.name}>{template.name} ({template.language})</option>)}
              {otherTemplates.length ? <optgroup label="Não aprovados">{otherTemplates.map((template) => <option key={`${template.name}-${template.language}`} value={template.name} disabled>{template.name} — {template.status}</option>)}</optgroup> : null}
            </select>
          </label>
          <ActionButton icon={<Send size={16} />} disabled={!phone || !templateName || sending} onClick={sendTest}>{sending ? "Enviando…" : "Enviar teste"}</ActionButton>
        </div>
      </section>

      <section className="rounded-lg border border-line bg-panel p-6 shadow-soft">
        <h2 className="text-lg font-semibold text-ink">Hubla</h2>
        <p className="mt-1 text-sm text-muted">Cole esta URL como webhook no painel da Hubla. Um único endpoint recebe todos os eventos e processa as automações ativas abaixo.</p>
        {hublaWebhookUrl ? <div className="mt-3 flex flex-wrap items-center gap-2">
          <code className="min-w-0 flex-1 truncate rounded-lg border border-line bg-wash px-3 py-2 text-xs text-ink">{hublaWebhookUrl}</code>
          <CopyButton value={hublaWebhookUrl} />
        </div> : <div className="mt-3 text-sm text-red-700">HUBLA_WEBHOOK_SECRET não configurado no servidor.</div>}
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-ink">Automações</h2>
          <ActionButton icon={<Plus size={16} />} onClick={startNewAutomation} className="border border-line bg-white text-ink hover:bg-wash">Nova automação</ActionButton>
        </div>

        {showAutomationForm ? <div className="mb-4 rounded-lg border border-line bg-panel p-6 shadow-soft">
          <h3 className="mb-4 text-base font-semibold text-ink">{editingAutomationId ? "Editar automação" : "Nova automação"}</h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="text-sm font-medium text-ink">Evento (exatamente como aparece nos eventos capturados)
              <input value={automationEventType} onChange={(event) => setAutomationEventType(event.target.value)} placeholder="invoice.payment_succeeded" className="mt-1 h-11 w-full rounded-lg border border-line px-3" />
            </label>
            <label className="text-sm font-medium text-ink">Produto (ID; deixe em branco para todos)
              <input value={automationProductId} onChange={(event) => setAutomationProductId(event.target.value)} placeholder="Todos os produtos" className="mt-1 h-11 w-full rounded-lg border border-line px-3" />
            </label>
            <label className="text-sm font-medium text-ink sm:col-span-2">Template
              <select value={automationTemplateName} onChange={(event) => selectAutomationTemplate(event.target.value)} className="mt-1 h-11 w-full rounded-lg border border-line bg-white px-3">
                <option value="">Selecione…</option>
                {approvedTemplates.map((template) => <option key={`${template.name}-${template.language}`} value={template.name} disabled={template.variables.buttons > 0}>{template.name} ({template.language}){template.variables.buttons > 0 ? " — botão dinâmico não suportado" : ""}</option>)}
              </select>
            </label>
          </div>

          {selectedAutomationTemplate && (automationMapping.header.length || automationMapping.body.length) ? <div className="mt-4 space-y-3 rounded-lg border border-line bg-wash p-4">
            <div className="text-sm font-medium text-ink">Variáveis do template</div>
            {automationMapping.header.map((slot) => <div key={`header-${slot.key}`} className="flex flex-wrap items-center gap-3 text-sm">
              <span className="w-40 shrink-0 text-muted">{"{{" + slot.key + "}}"} (cabeçalho)</span>
              <select value={slot.value} onChange={(event) => updateSlot("header", slot.key, { value: event.target.value })} className="h-10 min-w-0 flex-1 rounded-lg border border-line bg-white px-3">
                {INTERNAL_VARIABLES.map((variable) => <option key={variable.value} value={variable.value}>{variable.label}</option>)}
              </select>
              {slot.value === STATIC_OPTION ? <input value={slot.staticText} onChange={(event) => updateSlot("header", slot.key, { staticText: event.target.value })} placeholder="Valor fixo" className="h-10 min-w-0 flex-1 rounded-lg border border-line bg-white px-3" /> : null}
            </div>)}
            {automationMapping.body.map((slot) => <div key={`body-${slot.key}`} className="flex flex-wrap items-center gap-3 text-sm">
              <span className="w-40 shrink-0 text-muted">{"{{" + slot.key + "}}"} (corpo)</span>
              <select value={slot.value} onChange={(event) => updateSlot("body", slot.key, { value: event.target.value })} className="h-10 min-w-0 flex-1 rounded-lg border border-line bg-white px-3">
                {INTERNAL_VARIABLES.map((variable) => <option key={variable.value} value={variable.value}>{variable.label}</option>)}
              </select>
              {slot.value === STATIC_OPTION ? <input value={slot.staticText} onChange={(event) => updateSlot("body", slot.key, { staticText: event.target.value })} placeholder="Valor fixo" className="h-10 min-w-0 flex-1 rounded-lg border border-line bg-white px-3" /> : null}
            </div>)}
          </div> : null}

          <div className="mt-4 flex justify-end gap-2">
            <button type="button" onClick={resetAutomationForm} className="rounded-lg border border-line px-4 py-2 text-sm">Cancelar</button>
            <ActionButton disabled={!automationEventType || !automationTemplateName || savingAutomation} onClick={saveAutomation}>{savingAutomation ? "Salvando…" : editingAutomationId ? "Salvar alterações" : "Salvar"}</ActionButton>
          </div>
        </div> : null}

        <DataTable
          columns={["Quando", "Produto", "Template", "Status", "Ações"]}
          rows={automations.map((automation) => [
            automation.event_type,
            automation.product_name || automation.product_id || "Todos",
            `${automation.template_name} (${automation.template_language})`,
            <button key="toggle" type="button" onClick={() => toggleAutomation(automation)} className={`rounded-full border px-2.5 py-1 text-xs font-medium ${automation.active ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-line bg-wash text-muted"}`}>{automation.active ? "Ativo" : "Inativo"}</button>,
            <button key="edit" type="button" onClick={() => startEditingAutomation(automation)} className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-ink hover:bg-wash"><Pencil size={14} /> Editar</button>
          ])}
        />
      </section>

      <QuickReplyPanel />

      <section>
        <h2 className="mb-3 text-lg font-semibold text-ink">Últimos eventos Hubla</h2>
        {!hublaEvents.length ? <EmptyState title="Nenhum evento ainda" description="Configure o webhook acima na Hubla e gere um evento de teste (Pix ou venda) para ver o payload aqui." /> : <div className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-panel shadow-soft">
          {hublaEvents.map((hublaEvent) => {
            const expanded = expandedEventId === hublaEvent.id;
            return <div key={hublaEvent.id}>
              <div className="flex w-full items-center gap-3 px-4 py-3 text-sm hover:bg-wash/60">
                <button type="button" onClick={() => setExpandedEventId(expanded ? null : hublaEvent.id)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                  {expanded ? <ChevronDown size={16} className="shrink-0 text-muted" /> : <ChevronRight size={16} className="shrink-0 text-muted" />}
                  <span className="w-40 shrink-0 text-muted">{new Date(hublaEvent.created_at).toLocaleString("pt-BR")}</span>
                  <span className="w-44 shrink-0 font-medium text-ink">{hublaEvent.event_type || "tipo desconhecido"}</span>
                  <span className="min-w-0 flex-1 truncate text-muted">{hublaEvent.customer_name || "—"} {hublaEvent.product_name ? `· ${hublaEvent.product_name}` : ""}</span>
                </button>
                <span className="shrink-0 rounded-full border border-line bg-wash px-2.5 py-1 text-xs font-medium">{hublaEvent.status}</span>
                {["failed", "ignored"].includes(hublaEvent.status) ? <button type="button" onClick={() => setReprocessTarget(hublaEvent)} className="shrink-0 rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-ink hover:bg-wash">Reenviar</button> : null}
              </div>
              {expanded ? <pre className="max-h-96 overflow-auto bg-ink p-4 text-xs text-white">{JSON.stringify(hublaEvent.payload, null, 2)}</pre> : null}
            </div>;
          })}
        </div>}
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold text-ink">Últimas mensagens</h2>
        <DataTable
          columns={["Data", "Telefone", "Template", "Status", "Erro"]}
          rows={messages.map((message) => [
            new Date(message.created_at).toLocaleString("pt-BR"),
            message.phone,
            `${message.template_name} (${message.template_language})`,
            <span key="status" className={`rounded-full border px-2.5 py-1 text-xs font-medium ${message.status === "failed" ? "border-red-200 bg-red-50 text-red-700" : "border-emerald-200 bg-emerald-50 text-emerald-700"}`}>{message.status}</span>,
            message.error || "—"
          ])}
        />
      </section>
    </div>
    <ConfirmModal
      open={Boolean(reprocessTarget)}
      title="Reenviar mensagem?"
      onCancel={() => setReprocessTarget(null)}
      onConfirm={reprocessEvent}
      confirmLabel={reprocessing ? "Enviando…" : "Reenviar"}
      loading={reprocessing}
    >
      Isso vai processar o evento de {reprocessTarget?.customer_name || "cliente"} novamente e enviar uma mensagem real via WhatsApp, se houver automação ativa correspondente.
    </ConfirmModal>
    <Toast message={toast} />
  </AppShell>;
}
