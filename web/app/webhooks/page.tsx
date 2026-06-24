"use client";

import { ActionButton, AppShell, CopyButton, DataTable, StatusBadge, Toast } from "@/components/ui";
import { Check, Edit3, Eye, Play, Plus, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

type Tab = "configs" | "auth" | "history";

const eventLabels: Record<string, string> = {
  "order.paid": "Venda aprovada",
  "pix.generated": "Pix gerado",
  "order.refunded": "Reembolso"
};
const availableVariables = ["{{name}}", "{{email}}", "{{phone}}", "{{product_name}}", "{{product_id}}", "{{offer_name}}", "{{offer_id}}", "{{order_id}}", "{{payment_id}}", "{{amount}}", "{{event_type}}", "{{paid_at}}", "{{pix_code}}", "{{pix_qr_code}}", "{{refund_reason}}", "{{customer.name}}", "{{data.user.phoneNumber}}"];
const sample: Record<string, string> = {
  name: "Maria Silva",
  email: "maria@email.com",
  phone: "5511999999999",
  product_name: "Shop Lab",
  product_id: "prod_123",
  offer_name: "Aula ao vivo",
  offer_id: "offer_123",
  order_id: "order_123",
  payment_id: "pay_123",
  amount: "R$ 9,90",
  event_type: "order.paid",
  paid_at: "24/06/2026 09:50",
  pix_code: "000201010212...",
  pix_qr_code: "https://exemplo.com/qrcode",
  refund_reason: "Solicitação do cliente",
  group_link: "https://chat.whatsapp.com/exemplo",
  support_link: "https://wa.me/5511999999999"
};

const emptyForm = {
  id: "",
  name: "",
  webhook_token: "",
  status: "active",
  payload_format: "generic",
  selected_product_mode: "all",
  product_ids: "",
  selected_offer_mode: "all",
  offer_ids: "",
  selected_event_types: ["order.paid"],
  whatsapp_account_id: "default",
  templates: { "order.paid": "", "pix.generated": "", "order.refunded": "" } as Record<string, string>,
  fixed_variables: [{ key: "group_link", value: "" }],
  auth_type: "none",
  auth_header_name: "x-elevazap-webhook-key",
  auth_secret: "",
  auth_secret_configured: false
};

function inputClass() {
  return "focus-ring h-11 w-full rounded-lg border border-line bg-panel px-3 text-sm";
}

function textAreaClass() {
  return "focus-ring min-h-28 w-full rounded-lg border border-line bg-panel p-3 text-sm";
}

function previewTemplate(template: string, fixed: { key: string; value: string }[]) {
  const fixedMap = Object.fromEntries(fixed.filter((item) => item.key).map((item) => [item.key, item.value]));
  return template.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_m, key) => sample[key] || fixedMap[key] || "");
}

export default function WebhooksPage() {
  const [tab, setTab] = useState<Tab>("configs");
  const [rules, setRules] = useState<any[]>([]);
  const [events, setEvents] = useState<any[]>([]);
  const [drawer, setDrawer] = useState(false);
  const [form, setForm] = useState<any>(emptyForm);
  const [preview, setPreview] = useState("");
  const [testPhone, setTestPhone] = useState("");
  const [testEvent, setTestEvent] = useState("order.paid");
  const [historyStatus, setHistoryStatus] = useState("");
  const [toast, setToast] = useState("");
  const origin = typeof window === "undefined" ? "" : window.location.origin;

  async function loadRules() {
    const data = await fetch("/api/webhooks/rules", { cache: "no-store" }).then((r) => r.json());
    setRules(Array.isArray(data) ? data : []);
  }

  async function loadEvents() {
    const url = historyStatus ? `/api/webhooks/events?status=${historyStatus}` : "/api/webhooks/events";
    const data = await fetch(url, { cache: "no-store" }).then((r) => r.json());
    setEvents(Array.isArray(data) ? data : []);
  }

  useEffect(() => { loadRules(); }, []);
  useEffect(() => { loadEvents(); }, [historyStatus]);

  function openRule(rule?: any) {
    if (!rule) {
      setForm({ ...emptyForm, templates: { ...emptyForm.templates }, fixed_variables: [...emptyForm.fixed_variables] });
    } else {
      const templates = { ...emptyForm.templates };
      (rule.webhook_message_templates || []).forEach((item: any) => { templates[item.event_type] = item.template_body || ""; });
      setForm({
        ...emptyForm,
        ...rule,
        product_ids: (rule.product_ids || []).join(", "),
        offer_ids: (rule.offer_ids || []).join(", "),
        templates,
        fixed_variables: Object.entries(rule.fixed_variables || {}).map(([key, value]) => ({ key, value: String(value) })),
        auth_secret: "",
        auth_secret_configured: rule.auth_secret_configured
      });
    }
    setPreview("");
    setDrawer(true);
  }

  function setEvent(event: string, checked: boolean) {
    setForm((current: any) => ({
      ...current,
      selected_event_types: checked
        ? Array.from(new Set([...current.selected_event_types, event]))
        : current.selected_event_types.filter((item: string) => item !== event)
    }));
  }

  async function saveRule() {
    const payload = {
      ...form,
      product_ids: form.product_ids.split(",").map((item: string) => item.trim()).filter(Boolean),
      offer_ids: form.offer_ids.split(",").map((item: string) => item.trim()).filter(Boolean)
    };
    const response = await fetch("/api/webhooks/rules", { method: form.id ? "PATCH" : "POST", body: JSON.stringify(payload) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Falha ao salvar regra.");
    setToast("Regra salva.");
    setDrawer(false);
    await loadRules();
  }

  async function deleteRule(id: string) {
    if (!confirm("Excluir esta regra de webhook?")) return;
    const response = await fetch("/api/webhooks/rules", { method: "DELETE", body: JSON.stringify({ id }) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Falha ao excluir.");
    setToast("Regra excluída.");
    await loadRules();
  }

  async function sendTest() {
    const response = await fetch("/api/webhooks/test", { method: "POST", body: JSON.stringify({ rule_id: form.id, event_type: testEvent, phone: testPhone }) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Falha ao enviar teste.");
    setToast("Teste colocado na fila.");
    setPreview(data.rendered || "");
    await loadEvents();
  }

  const rows = useMemo(() => rules.map((rule) => {
    const url = `${origin}/api/webhooks/elevazap/${rule.webhook_token}`;
    return [
      <div key="n"><div className="font-medium text-ink">{rule.name}</div><div className="mt-1 text-xs text-muted">{rule.payload_format}</div></div>,
      <div key="u" className="flex max-w-sm items-center gap-2"><code className="truncate text-xs">{url}</code><CopyButton value={url} /></div>,
      <div key="e" className="flex flex-wrap gap-1">{(rule.selected_event_types || []).map((event: string) => <span key={event} className="rounded-full bg-wash px-2 py-1 text-xs">{eventLabels[event] || event}</span>)}</div>,
      rule.whatsapp_account_id || "default",
      <StatusBadge key="s" status={rule.status === "active" ? "sucesso" : "pausado"} />,
      <div key="a" className="flex gap-2"><button title="Editar" className="rounded-lg border border-line p-2" onClick={() => openRule(rule)}><Edit3 size={16} /></button><button title="Excluir" className="rounded-lg border border-line p-2 text-red-600" onClick={() => deleteRule(rule.id)}><Trash2 size={16} /></button></div>
    ];
  }), [rules, origin]);

  return <AppShell title="Webhooks" subtitle="Automações de WhatsApp por eventos externos">
    <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex gap-2 overflow-x-auto">
        {[
          ["configs", "Configurações"],
          ["auth", "Autenticação"],
          ["history", "Histórico"]
        ].map(([id, label]) => <button key={id} className={`rounded-lg px-4 py-2 text-sm ${tab === id ? "bg-accent text-white" : "bg-panel text-muted"}`} onClick={() => setTab(id as Tab)}>{label}</button>)}
      </div>
      <ActionButton icon={<Plus size={16} />} onClick={() => openRule()}>Nova regra</ActionButton>
    </div>

    {tab === "configs" ? <DataTable columns={["Nome", "URL", "Eventos", "Conta WhatsApp", "Status", "Ações"]} rows={rows} /> : null}

    {tab === "auth" ? <div className="space-y-3">
      {rules.map((rule) => <div key={rule.id} className="rounded-lg border border-line bg-panel p-4 shadow-soft">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div><div className="font-medium text-ink">{rule.name}</div><div className="text-sm text-muted">{rule.auth_type === "none" ? "Sem autenticação" : rule.auth_type === "header" ? `Header: ${rule.auth_header_name}` : "API key no body"} {rule.auth_secret_configured ? "• valor configurado" : ""}</div></div>
          <button className="rounded-lg border border-line px-3 py-2 text-sm" onClick={() => openRule(rule)}>Editar autenticação</button>
        </div>
      </div>)}
    </div> : null}

    {tab === "history" ? <div>
      <div className="mb-4 grid gap-3 md:grid-cols-[220px_1fr]"><select className={inputClass()} value={historyStatus} onChange={(e) => setHistoryStatus(e.target.value)}><option value="">Todos</option><option value="queued">Na fila</option><option value="sent">Enviado</option><option value="success">Sucesso</option><option value="failed">Falhas</option><option value="ignored">Ignorados</option><option value="auth_error">Erro de autenticação</option><option value="duplicated">Duplicados</option></select><div /></div>
      <DataTable columns={["Evento", "Regra", "Status", "HTTP", "Data", "Detalhes"]} rows={events.map((event) => [
        eventLabels[event.event_type] || event.event_type || "-",
        event.webhook_rules?.name || "-",
        <StatusBadge key="s" status={event.status === "queued" ? "enfileirado" : event.status === "failed" || event.status === "auth_error" ? "erro" : event.status === "success" || event.status === "sent" ? "sucesso" : event.status} />,
        event.http_status || "-",
        event.created_at ? new Date(event.created_at).toLocaleString() : "-",
        <details key="d"><summary className="cursor-pointer text-muted">Abrir</summary><div className="mt-3 grid gap-3 text-xs"><div><b>Mensagem:</b><pre className="mt-1 max-w-xl whitespace-pre-wrap rounded-lg bg-wash p-3">{event.rendered_message || event.message || event.error_message || "-"}</pre></div><div><b>Payload normalizado:</b><pre className="mt-1 max-w-xl overflow-auto rounded-lg bg-wash p-3">{JSON.stringify(event.normalized_payload, null, 2)}</pre></div><div><b>Condições:</b><pre className="mt-1 max-w-xl overflow-auto rounded-lg bg-wash p-3">{JSON.stringify(event.conditions_result, null, 2)}</pre></div></div></details>
      ])} />
    </div> : null}

    {drawer ? <div className="fixed inset-0 z-50 flex justify-end bg-ink/30">
      <div className="h-full w-full max-w-3xl overflow-y-auto bg-panel p-6 shadow-soft">
        <div className="mb-5 flex items-center justify-between"><h2 className="text-lg font-semibold text-ink">{form.id ? "Editar regra" : "Nova regra"}</h2><button className="rounded-lg border border-line p-2" onClick={() => setDrawer(false)}><X size={16} /></button></div>
        <div className="grid gap-4">
          <label className="text-sm font-medium text-ink">Nome da regra<input className={inputClass()} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
          {form.webhook_token ? <label className="text-sm font-medium text-ink">URL do webhook<div className="mt-1 flex gap-2"><input readOnly className={inputClass()} value={`${origin}/api/webhooks/elevazap/${form.webhook_token}`} /><CopyButton value={`${origin}/api/webhooks/elevazap/${form.webhook_token}`} /></div></label> : null}
          <div className="grid gap-3 md:grid-cols-2">
            <label className="text-sm font-medium text-ink">Formato do payload<select className={inputClass()} value={form.payload_format} onChange={(e) => setForm({ ...form, payload_format: e.target.value })}><option value="generic">Genérico / ElevaPay</option><option value="sendflow">Compatível SendFlow</option></select></label>
            <label className="text-sm font-medium text-ink">Status<select className={inputClass()} value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}><option value="active">Ativo</option><option value="inactive">Inativo</option></select></label>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <label className="text-sm font-medium text-ink">Produtos<select className={inputClass()} value={form.selected_product_mode} onChange={(e) => setForm({ ...form, selected_product_mode: e.target.value })}><option value="all">Todos os produtos</option><option value="specific">Específicos</option></select>{form.selected_product_mode === "specific" ? <input className={`${inputClass()} mt-2`} placeholder="prod_123, prod_456" value={form.product_ids} onChange={(e) => setForm({ ...form, product_ids: e.target.value })} /> : null}</label>
            <label className="text-sm font-medium text-ink">Ofertas<select className={inputClass()} value={form.selected_offer_mode} onChange={(e) => setForm({ ...form, selected_offer_mode: e.target.value })}><option value="all">Todas as ofertas</option><option value="specific">Específicas</option></select>{form.selected_offer_mode === "specific" ? <input className={`${inputClass()} mt-2`} placeholder="offer_123, offer_456" value={form.offer_ids} onChange={(e) => setForm({ ...form, offer_ids: e.target.value })} /> : null}</label>
          </div>
          <section className="rounded-lg border border-line p-4"><div className="font-medium text-ink">Eventos</div><div className="mt-3 grid gap-2 sm:grid-cols-3">{Object.entries(eventLabels).map(([event, label]) => <label key={event} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.selected_event_types.includes(event)} onChange={(e) => setEvent(event, e.target.checked)} /> {label}</label>)}</div></section>
          <label className="text-sm font-medium text-ink">Conta WhatsApp remetente<select className={inputClass()} value={form.whatsapp_account_id} onChange={(e) => setForm({ ...form, whatsapp_account_id: e.target.value })}><option value="default">WhatsApp conectado</option></select></label>
          <section className="rounded-lg border border-line p-4">
            <div className="font-medium text-ink">Templates de mensagem</div>
            <div className="mt-2 flex flex-wrap gap-2">{availableVariables.map((item) => <code key={item} className="rounded bg-wash px-2 py-1 text-xs">{item}</code>)}</div>
            <div className="mt-4 space-y-4">{form.selected_event_types.map((event: string) => <label key={event} className="block text-sm font-medium text-ink">{eventLabels[event]}<textarea className={`${textAreaClass()} mt-1`} value={form.templates[event] || ""} onChange={(e) => setForm({ ...form, templates: { ...form.templates, [event]: e.target.value } })} /></label>)}</div>
          </section>
          <section className="rounded-lg border border-line p-4">
            <div className="font-medium text-ink">Variáveis fixas da regra</div>
            <div className="mt-3 space-y-2">{form.fixed_variables.map((item: any, index: number) => <div key={index} className="grid gap-2 md:grid-cols-[1fr_1fr_auto]"><input className={inputClass()} placeholder="group_link" value={item.key} onChange={(e) => setForm({ ...form, fixed_variables: form.fixed_variables.map((v: any, i: number) => i === index ? { ...v, key: e.target.value } : v) })} /><input className={inputClass()} placeholder="https://..." value={item.value} onChange={(e) => setForm({ ...form, fixed_variables: form.fixed_variables.map((v: any, i: number) => i === index ? { ...v, value: e.target.value } : v) })} /><button className="rounded-lg border border-line px-3" onClick={() => setForm({ ...form, fixed_variables: form.fixed_variables.filter((_: any, i: number) => i !== index) })}><Trash2 size={15} /></button></div>)}</div>
            <button className="mt-3 rounded-lg border border-line px-3 py-2 text-sm" onClick={() => setForm({ ...form, fixed_variables: [...form.fixed_variables, { key: "", value: "" }] })}>Adicionar variável</button>
          </section>
          <section className="rounded-lg border border-line p-4">
            <div className="font-medium text-ink">Autenticação</div>
            <div className="mt-3 grid gap-3 md:grid-cols-3"><select className={inputClass()} value={form.auth_type} onChange={(e) => setForm({ ...form, auth_type: e.target.value })}><option value="none">Nenhuma</option><option value="header">Header</option><option value="body_api_key">API key no body</option></select>{form.auth_type === "header" ? <input className={inputClass()} value={form.auth_header_name} onChange={(e) => setForm({ ...form, auth_header_name: e.target.value })} /> : null}{form.auth_type !== "none" ? <input className={inputClass()} type="password" placeholder={form.auth_secret_configured ? "Valor configurado. Preencha para trocar." : "Valor secreto"} value={form.auth_secret} onChange={(e) => setForm({ ...form, auth_secret: e.target.value })} /> : null}</div>
          </section>
          <section className="rounded-lg border border-line p-4">
            <div className="flex flex-wrap gap-2"><button className="rounded-lg border border-line px-3 py-2 text-sm" onClick={() => setPreview(previewTemplate(form.templates[form.selected_event_types[0]] || "", form.fixed_variables))}><Eye size={15} className="mr-1 inline" /> Pré-visualizar</button>{form.id ? <><input className="h-10 rounded-lg border border-line bg-panel px-3 text-sm" placeholder="WhatsApp para teste" value={testPhone} onChange={(e) => setTestPhone(e.target.value)} /><select className="h-10 rounded-lg border border-line bg-panel px-3 text-sm" value={testEvent} onChange={(e) => setTestEvent(e.target.value)}>{form.selected_event_types.map((event: string) => <option key={event} value={event}>{eventLabels[event]}</option>)}</select><button className="rounded-lg border border-line px-3 py-2 text-sm" onClick={sendTest}><Play size={15} className="mr-1 inline" /> Enviar teste</button></> : null}</div>
            {preview ? <pre className="mt-3 whitespace-pre-wrap rounded-lg bg-wash p-3 text-sm">{preview}</pre> : null}
          </section>
          <div className="sticky bottom-0 -mx-6 flex justify-end gap-2 border-t border-line bg-panel p-4"><button className="rounded-lg border border-line px-4 py-2 text-sm" onClick={() => setDrawer(false)}>Cancelar</button><ActionButton icon={<Check size={16} />} onClick={saveRule}>Salvar alterações</ActionButton></div>
        </div>
      </div>
    </div> : null}
    <Toast message={toast} />
  </AppShell>;
}
