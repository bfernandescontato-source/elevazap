"use client";

import Link from "next/link";
import { ConnectionSelect } from "../connection-select";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ActionButton, AppShell, DataTable, EmptyState, ErrorState, FileDropzone, LoadingState, Toast } from "@/components/ui";
import { ArrowLeft, ArrowRight, Pencil, Plus, Send } from "lucide-react";

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
const RESPONSE_TYPES = [
  { value: "text", label: "Texto" },
  { value: "image", label: "Imagem" },
  { value: "video", label: "Vídeo" },
  { value: "audio", label: "Áudio" },
  { value: "document", label: "Documento" }
];

type MappingSlot = { key: string; value: string; staticText: string };
type Template = { name: string; category: string; status: string; language: string; variables: { header: number; body: number; buttons: number }; parameterFormat: "POSITIONAL" | "NAMED"; namedVariables: { header: string[]; body: string[] }; dynamicUrlButtonIndexes: string[] };
type FlowAction = {
  payload: string; button_label: string | null; response_type: "text" | "image" | "video" | "audio" | "document";
  response_text: string | null; caption: string | null; media_bucket: string | null; media_path: string | null;
  mime_type: string | null; file_name: string | null;
  button_config: { type: "url" | "quick_reply"; text: string; url?: string; payload?: string } | null;
};
type Flow = {
  quick_reply_payload?: string | null;
  id: string; name: string; initial_template_name: string; initial_template_language: string; active: boolean;
  variable_mapping: { header?: Record<string, string>; body?: Record<string, string>; buttons?: Record<string, string> };
  official_quick_reply_actions: FlowAction;
};

function StaticTextArea({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const resize = () => {
    const textarea = ref.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${textarea.scrollHeight}px`;
  };

  // Também recalcula ao abrir um fluxo existente, para o conteúdo salvo aparecer inteiro.
  useLayoutEffect(resize, [value]);

  return <textarea
    ref={ref}
    value={value}
    onChange={(event) => onChange(event.target.value)}
    onInput={resize}
    rows={2}
    placeholder="Valor fixo"
    className="min-h-10 min-w-0 flex-1 resize-none overflow-hidden rounded-lg border border-line bg-white px-3 py-2 leading-5"
  />;
}

export default function FluxosPage() {
  const [connectionId, setConnectionId] = useState("legacy");
  const [flows, setFlows] = useState<Flow[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [templatesError, setTemplatesError] = useState("");
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingFlowId, setEditingFlowId] = useState<string | null>(null);
  const [existingMedia, setExistingMedia] = useState<{ bucket: string; path: string; mimeType: string | null; fileName: string | null } | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [toast, setToast] = useState("");

  const [name, setName] = useState("");
  const [initialTemplateName, setInitialTemplateName] = useState("");
  const [mapping, setMapping] = useState<{ header: MappingSlot[]; body: MappingSlot[]; buttons: MappingSlot[] }>({ header: [], body: [], buttons: [] });
  const [qrPayload, setQrPayload] = useState("");
  const [qrLabel, setQrLabel] = useState("");
  const [responseType, setResponseType] = useState<"text" | "image" | "video" | "audio" | "document">("text");
  const [responseText, setResponseText] = useState("");
  const [caption, setCaption] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [hasButton, setHasButton] = useState(false);
  const [buttonType, setButtonType] = useState<"url" | "quick_reply">("url");
  const [buttonText, setButtonText] = useState("");
  const [buttonUrl, setButtonUrl] = useState("");
  const [buttonPayload, setButtonPayload] = useState("");

  const [testFlowId, setTestFlowId] = useState<string | null>(null);
  const [testPhone, setTestPhone] = useState("");
  const [testName, setTestName] = useState("");
  const [testProduct, setTestProduct] = useState("");
  const [starting, setStarting] = useState(false);

  async function loadFlows() {
    const response = await fetch("/api/admin/official/flows", { cache: "no-store" });
    const data = await response.json();
    setFlows(data.flows || []);
  }
  async function loadTemplates() {
    const response = await fetch(`/api/admin/official/templates?connectionId=${encodeURIComponent(connectionId)}`, { cache: "no-store" });
    const data = await response.json();
    if (response.ok) { setTemplates(data.templates || []); setTemplatesError(""); }
    else setTemplatesError(data.error || "Falha ao carregar templates.");
  }
  useEffect(() => { setLoading(true); Promise.all([loadFlows(), loadTemplates()]).catch(() => setTemplatesError("Não foi possível carregar os dados. Tente novamente.")).finally(() => setLoading(false)); }, [connectionId]);

  function decodeSlotValue(raw: string | undefined): { value: string; staticText: string } {
    if (!raw) return { value: "first_name", staticText: "" };
    if (raw.startsWith("static:")) return { value: STATIC_OPTION, staticText: raw.slice("static:".length) };
    return { value: raw, staticText: "" };
  }
  function slotsFor(count: number, names: string[], existing?: Record<string, string>): MappingSlot[] {
    const keys = names.length ? names : Array.from({ length: count }, (_, index) => String(index + 1));
    return keys.map((key) => ({ key, ...decodeSlotValue(existing?.[key]) }));
  }
  function selectTemplate(templateName: string, existingMapping?: Flow["variable_mapping"]) {
    setInitialTemplateName(templateName);
    const template = templates.find((item) => item.name === templateName);
    if (!template) { setMapping({ header: [], body: [], buttons: [] }); return; }
    setMapping({
      header: slotsFor(template.variables.header, template.namedVariables.header, existingMapping?.header),
      body: slotsFor(template.variables.body, template.namedVariables.body, existingMapping?.body),
      buttons: slotsFor(template.variables.buttons, template.dynamicUrlButtonIndexes, existingMapping?.buttons)
    });
  }
  function updateSlot(section: "header" | "body" | "buttons", key: string, changes: Partial<MappingSlot>) {
    setMapping((current) => ({ ...current, [section]: current[section].map((slot) => slot.key === key ? { ...slot, ...changes } : slot) }));
  }
  function slotsToMapping(slots: MappingSlot[]) {
    return Object.fromEntries(slots.map((slot) => [slot.key, slot.value === STATIC_OPTION ? `static:${slot.staticText}` : slot.value]));
  }

  function resetForm() {
    setEditingFlowId(null); setExistingMedia(null);
    setName(""); setInitialTemplateName(""); setMapping({ header: [], body: [], buttons: [] });
    setQrPayload(""); setQrLabel(""); setResponseType("text"); setResponseText(""); setCaption(""); setFile(null);
    setHasButton(false); setButtonType("url"); setButtonText(""); setButtonUrl(""); setButtonPayload("");
  }

  function startEdit(flow: Flow) {
    const action = flow.official_quick_reply_actions;
    setEditingFlowId(flow.id);
    setName(flow.name);
    selectTemplate(flow.initial_template_name, flow.variable_mapping);
    setQrPayload(flow.quick_reply_payload || action.payload);
    setQrLabel(action.button_label || "");
    setResponseType(action.response_type);
    setResponseText(action.response_text || "");
    setCaption(action.caption || "");
    setFile(null);
    setExistingMedia(action.media_bucket && action.media_path ? { bucket: action.media_bucket, path: action.media_path, mimeType: action.mime_type, fileName: action.file_name } : null);
    setHasButton(Boolean(action.button_config));
    setButtonType(action.button_config?.type || "url");
    setButtonText(action.button_config?.text || "");
    setButtonUrl(action.button_config?.type === "url" ? action.button_config.url || "" : "");
    setButtonPayload(action.button_config?.type === "quick_reply" ? action.button_config.payload || "" : "");
    setShowForm(true);
  }

  async function uploadFile(selected: File) {
    const signedRes = await fetch("/api/admin/official/upload/signed-url", {
      method: "POST", body: JSON.stringify({ responseType, file_name: selected.name, mime_type: selected.type, file_size_bytes: selected.size })
    });
    const signed = await signedRes.json();
    if (!signedRes.ok) throw new Error(signed.error || "Falha ao preparar upload.");
    await fetch(signed.signedUrl, { method: "PUT", headers: { "content-type": selected.type }, body: selected });
    await fetch("/api/admin/official/upload/confirm", { method: "POST", body: JSON.stringify({ storage_path: signed.storage_path }) });
    return { bucket: signed.bucket as string, storage_path: signed.storage_path as string, mime_type: selected.type };
  }

  async function saveFlow() {
    const selectedTemplate = templates.find((item) => item.name === initialTemplateName);
    const hasMedia = Boolean(file || existingMedia);
    if (!name || !selectedTemplate || !qrPayload || (responseType === "text" && !responseText) || (responseType !== "text" && !hasMedia)) return;
    setSaving(true);
    try {
      let media: { bucket: string; storage_path: string; mime_type: string; file_name: string | null } | null = existingMedia
        ? { bucket: existingMedia.bucket, storage_path: existingMedia.path, mime_type: existingMedia.mimeType || "", file_name: existingMedia.fileName }
        : null;
      if (file) { setUploading(true); const uploaded = await uploadFile(file); media = { ...uploaded, file_name: file.name }; setUploading(false); }
      const variableMapping = {
        ...(mapping.header.length ? { header: slotsToMapping(mapping.header) } : {}),
        ...(mapping.body.length ? { body: slotsToMapping(mapping.body) } : {}),
        ...(mapping.buttons.length ? { buttons: slotsToMapping(mapping.buttons) } : {})
      };
      const followupButtonConfig = hasButton && responseType !== "audio"
        ? (buttonType === "url" ? { type: "url", text: buttonText, url: buttonUrl } : { type: "quick_reply", text: buttonText, payload: buttonPayload })
        : null;
      const response = await fetch(editingFlowId ? `/api/admin/official/flows/${editingFlowId}` : "/api/admin/official/flows", {
        method: editingFlowId ? "PATCH" : "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name, initialTemplateName: selectedTemplate.name, initialTemplateLanguage: selectedTemplate.language, variableMapping,
          quickReplyPayload: qrPayload, quickReplyLabel: qrLabel || null,
          followupResponseType: responseType, followupResponseText: responseType === "text" ? responseText : null,
          followupMediaBucket: media?.bucket || null, followupMediaPath: media?.storage_path || null,
          followupMimeType: media?.mime_type || null, followupFileName: media?.file_name || null,
          followupCaption: responseType !== "text" ? (caption || null) : null,
          followupButtonConfig
        })
      });
      const data = await response.json();
      setToast(response.ok ? (editingFlowId ? "Fluxo atualizado." : "Fluxo criado.") : `Falha: ${data.error || "erro desconhecido"}.`);
      if (response.ok) { setShowForm(false); resetForm(); await loadFlows(); }
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Falha ao salvar.");
    } finally {
      setSaving(false); setUploading(false);
      setTimeout(() => setToast(""), 4000);
    }
  }

  async function toggleFlow(flow: Flow) {
    const response = await fetch(`/api/admin/official/flows/${flow.id}`, {
      method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ active: !flow.active })
    });
    if (response.ok) await loadFlows();
  }

  async function startTestFlow() {
    if (!testFlowId || !testPhone || starting) return;
    setStarting(true);
    try {
      const response = await fetch(`/api/admin/official/flows/${testFlowId}/start`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ phone: testPhone, customerName: testName || null, productName: testProduct || null, connectionId })
      });
      const data = await response.json();
      setToast(response.ok ? "Fluxo iniciado — mensagem enviada." : `Falha ao iniciar: ${data.error || "erro desconhecido"}.`);
    } finally {
      setStarting(false);
      setTimeout(() => setToast(""), 4000);
    }
  }

  const approvedTemplates = templates.filter((template) => template.status === "APPROVED");
  const selectedTemplate = templates.find((item) => item.name === initialTemplateName);

  if (loading) return <AppShell title="Fluxos" subtitle="WhatsApp Oficial"><LoadingState /></AppShell>;

  return <AppShell title="Fluxos para disparos" subtitle="Prepare a conversa que será usada ao enviar uma lista. Compras aprovadas são configuradas em Automações.">
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <Link href="/admin/whatsapp-oficial" className="inline-flex items-center gap-2 text-sm text-muted hover:text-ink"><ArrowLeft size={15} /> Visão geral</Link>
        <Link href="/admin/whatsapp-oficial/disparos" className="inline-flex items-center gap-2 text-sm font-medium text-ink hover:underline">Disparo 1x1 <ArrowRight size={15} /></Link>
      </div>

      <section className="rounded-xl border border-line bg-panel p-5"><ConnectionSelect value={connectionId} disabled={saving || starting || showForm} onChange={setConnectionId} /></section>
      <p className="rounded-xl border border-line bg-wash p-4 text-sm text-muted">Aqui você prepara o modelo inicial e a resposta ao clique para <Link href="/admin/whatsapp-oficial/disparos" className="font-medium underline">Disparos 1 a 1</Link>. Para compra aprovada de um produto, configure tudo em <Link href="/admin/whatsapp-oficial/automacoes" className="font-medium underline">Automações</Link>.</p>
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-ink">Fluxos</h2>
          <ActionButton icon={<Plus size={16} />} onClick={() => { if (showForm) { setShowForm(false); resetForm(); } else { resetForm(); setShowForm(true); } }} className="border border-line bg-white text-ink hover:bg-wash">Novo fluxo</ActionButton>
        </div>
        {templatesError ? <div className="mb-3"><ErrorState message={templatesError} /></div> : null}

        {showForm ? <div className="mb-4 rounded-lg border border-line bg-panel p-6 shadow-soft">
          <h3 className="mb-3 text-sm font-semibold text-ink">{editingFlowId ? "Editar fluxo" : "Novo fluxo"}</h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="text-sm font-medium text-ink sm:col-span-2">Nome do fluxo
              <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Convite Grupo Achadinhos" className="mt-1 h-11 w-full rounded-lg border border-line px-3" />
            </label>
            <label className="text-sm font-medium text-ink sm:col-span-2">Template inicial
              <select value={initialTemplateName} onChange={(event) => selectTemplate(event.target.value)} className="mt-1 h-11 w-full rounded-lg border border-line bg-white px-3">
                <option value="">Selecione…</option>
                {approvedTemplates.map((template) => <option key={`${template.name}-${template.language}`} value={template.name}>{template.name} ({template.language})</option>)}
              </select>
            </label>
          </div>

          {selectedTemplate && (mapping.header.length || mapping.body.length || mapping.buttons.length) ? <div className="mt-4 space-y-3 rounded-lg border border-line bg-wash p-4">
            <div className="text-sm font-medium text-ink">Variáveis do template inicial</div>
            {[...mapping.header.map((slot) => ({ ...slot, section: "header" as const })), ...mapping.body.map((slot) => ({ ...slot, section: "body" as const })), ...mapping.buttons.map((slot) => ({ ...slot, section: "buttons" as const }))].map((slot) => <div key={`${slot.section}-${slot.key}`} className="flex flex-wrap items-center gap-3 text-sm">
              <span className="w-40 shrink-0 text-muted">{"{{" + slot.key + "}}"} ({slot.section === "header" ? "cabeçalho" : slot.section === "body" ? "corpo" : "URL do botão"})</span>
              <select value={slot.value} onChange={(event) => updateSlot(slot.section, slot.key, { value: event.target.value })} className="h-10 min-w-0 flex-1 rounded-lg border border-line bg-white px-3">
                {INTERNAL_VARIABLES.map((variable) => <option key={variable.value} value={variable.value}>{variable.label}</option>)}
              </select>
              {slot.value === STATIC_OPTION ? <StaticTextArea
                value={slot.staticText}
                onChange={(staticText) => updateSlot(slot.section, slot.key, { staticText })}
              /> : null}
            </div>)}
          </div> : null}

          <div className="mt-4 rounded-lg border border-line bg-wash p-4">
            <div className="text-sm font-medium text-ink">Botão que inicia a resposta</div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <label className="text-sm text-ink">Texto do botão da mensagem inicial
                <input value={qrPayload} onChange={(event) => setQrPayload(event.target.value)} placeholder="QUERO ACESSAR" className="mt-1 h-10 w-full rounded-lg border border-line px-3" />
              </label>
              <label className="text-sm text-ink">Rótulo (opcional)
                <input value={qrLabel} onChange={(event) => setQrLabel(event.target.value)} placeholder="QUERO ACESSAR" className="mt-1 h-10 w-full rounded-lg border border-line px-3" />
              </label>
            </div>
          </div>

          <div className="mt-4 rounded-lg border border-line bg-wash p-4">
            <div className="text-sm font-medium text-ink">Resposta após o clique</div>
            <label className="mt-3 block text-sm text-ink">Tipo
              <select value={responseType} onChange={(event) => { const value = event.target.value as typeof responseType; setResponseType(value); setFile(null); if (value === "audio") setHasButton(false); }} className="mt-1 h-10 w-full rounded-lg border border-line bg-white px-3">
                {RESPONSE_TYPES.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}
              </select>
            </label>
            {responseType === "text" ? <label className="mt-3 block text-sm text-ink">Mensagem
              <textarea value={responseText} onChange={(event) => setResponseText(event.target.value)} rows={4} placeholder={"Perfeito, {{first_name}}! Seu acesso está liberado."} className="mt-1 w-full rounded-lg border border-line px-3 py-2" />
            </label> : <div className="mt-3 space-y-3">
              <div><FileDropzone onFile={setFile} />{file ? <div className="mt-1 text-xs text-muted">{file.name}</div> : existingMedia ? <div className="mt-1 text-xs text-muted">Arquivo atual: {existingMedia.fileName || existingMedia.path.split("/").pop()} (envie um novo pra substituir)</div> : null}</div>
              {responseType !== "audio" ? <label className="block text-sm text-ink">Legenda {hasButton ? "(obrigatória com botão)" : "(opcional)"}
                <textarea value={caption} onChange={(event) => setCaption(event.target.value)} rows={2} className="mt-1 w-full rounded-lg border border-line px-3 py-2" />
              </label> : null}
            </div>}

            {responseType !== "audio" ? <div className="mt-3">
              <label className="flex items-center gap-2 text-sm font-medium text-ink"><input type="checkbox" checked={hasButton} onChange={(event) => setHasButton(event.target.checked)} /> Botão final na resposta?</label>
              {hasButton ? <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <label className="text-sm text-ink">Tipo
                  <select value={buttonType} onChange={(event) => setButtonType(event.target.value as "url" | "quick_reply")} className="mt-1 h-10 w-full rounded-lg border border-line bg-white px-3">
                    <option value="url">Abrir link</option>
                    <option value="quick_reply">Resposta rápida</option>
                  </select>
                </label>
                <label className="text-sm text-ink">Texto do botão
                  <input value={buttonText} onChange={(event) => setButtonText(event.target.value)} placeholder="ENTRAR NO GRUPO" className="mt-1 h-10 w-full rounded-lg border border-line px-3" />
                </label>
                {buttonType === "url" ? <label className="text-sm text-ink sm:col-span-2">URL
                  <input value={buttonUrl} onChange={(event) => setButtonUrl(event.target.value)} placeholder="https://chat.whatsapp.com/..." className="mt-1 h-10 w-full rounded-lg border border-line px-3" />
                </label> : <label className="text-sm text-ink sm:col-span-2">Payload
                  <input value={buttonPayload} onChange={(event) => setButtonPayload(event.target.value)} className="mt-1 h-10 w-full rounded-lg border border-line px-3" />
                </label>}
              </div> : null}
            </div> : null}
          </div>

          <div className="mt-4 flex justify-end gap-2">
            <button type="button" onClick={() => { setShowForm(false); resetForm(); }} className="rounded-lg border border-line px-4 py-2 text-sm">Cancelar</button>
            <ActionButton disabled={saving || uploading} onClick={saveFlow}>{uploading ? "Enviando arquivo…" : saving ? "Salvando…" : editingFlowId ? "Salvar alterações" : "Salvar fluxo"}</ActionButton>
          </div>
        </div> : null}

        {!flows.length ? <EmptyState title="Nenhum fluxo ainda" description="Crie o primeiro fluxo acima." /> : <DataTable
          columns={["Nome", "Modelo inicial", "Botão inicial", "Status", "", ""]}
          rows={flows.map((flow) => [
            flow.name,
            `${flow.initial_template_name} (${flow.initial_template_language})`,
            flow.official_quick_reply_actions?.button_label || flow.quick_reply_payload || flow.official_quick_reply_actions?.payload || "—",
            <button key="toggle" type="button" onClick={() => toggleFlow(flow)} className={`rounded-full border px-2.5 py-1 text-xs font-medium ${flow.active ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-line bg-wash text-muted"}`}>{flow.active ? "Ativo" : "Inativo"}</button>,
            <button key="edit" type="button" onClick={() => startEdit(flow)} className="inline-flex items-center gap-1 rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-ink hover:bg-wash"><Pencil size={13} /> Editar</button>,
            <button key="test" type="button" onClick={() => setTestFlowId(testFlowId === flow.id ? null : flow.id)} className="rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-ink hover:bg-wash">Testar</button>
          ])}
        />}
      </section>

      {testFlowId ? <section className="rounded-lg border border-line bg-panel p-6 shadow-soft">
        <h2 className="text-lg font-semibold text-ink">Testar fluxo manualmente</h2>
        <p className="mt-1 text-sm text-muted">Envia o template inicial pra um contato real e cria o registro que permite achar o contexto certo quando ele clicar no botão.</p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className="text-sm font-medium text-ink">Telefone
            <input value={testPhone} onChange={(event) => setTestPhone(event.target.value)} placeholder="+55 19 99999-9999" className="mt-1 h-11 w-full rounded-lg border border-line px-3" />
          </label>
          <label className="text-sm font-medium text-ink">Nome
            <input value={testName} onChange={(event) => setTestName(event.target.value)} placeholder="Juan Marco" className="mt-1 h-11 w-full rounded-lg border border-line px-3" />
          </label>
          <label className="text-sm font-medium text-ink sm:col-span-2">Produto
            <input value={testProduct} onChange={(event) => setTestProduct(event.target.value)} placeholder="Achadinhos Ads" className="mt-1 h-11 w-full rounded-lg border border-line px-3" />
          </label>
        </div>
        <ActionButton icon={<Send size={16} />} disabled={!testPhone || starting} onClick={startTestFlow} className="mt-4">{starting ? "Iniciando…" : "Iniciar fluxo"}</ActionButton>
      </section> : null}
    </div>
    <Toast message={toast} />
  </AppShell>;
}
