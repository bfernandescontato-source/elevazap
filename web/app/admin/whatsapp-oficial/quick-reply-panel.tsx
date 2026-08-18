"use client";

import { useEffect, useState } from "react";
import { ActionButton, DataTable, EmptyState, FileDropzone, Toast } from "@/components/ui";
import { Plus } from "lucide-react";

type QuickReplyAction = {
  id: string;
  payload: string;
  button_label: string | null;
  response_type: "text" | "image" | "video" | "audio" | "document";
  response_text: string | null;
  caption: string | null;
  file_name: string | null;
  button_config: { type: "url" | "quick_reply"; text: string; url?: string; payload?: string } | null;
  active: boolean;
};

type QuickReplyEvent = {
  id: string;
  event_type: string | null;
  customer_phone: string | null;
  status: string;
  error: string | null;
  created_at: string;
  official_quick_reply_actions: { response_type: string; button_label: string | null } | null;
  official_messages: { meta_message_id: string | null; status: string; error: string | null }[] | null;
};

const RESPONSE_TYPES = [
  { value: "text", label: "Texto" },
  { value: "image", label: "Imagem" },
  { value: "video", label: "Vídeo" },
  { value: "audio", label: "Áudio" },
  { value: "document", label: "Documento" }
];

export function QuickReplyPanel() {
  const [actions, setActions] = useState<QuickReplyAction[]>([]);
  const [events, setEvents] = useState<QuickReplyEvent[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [toast, setToast] = useState("");

  const [payload, setPayload] = useState("");
  const [buttonLabel, setButtonLabel] = useState("");
  const [responseType, setResponseType] = useState<QuickReplyAction["response_type"]>("text");
  const [responseText, setResponseText] = useState("");
  const [caption, setCaption] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [hasButton, setHasButton] = useState(false);
  const [buttonType, setButtonType] = useState<"url" | "quick_reply">("url");
  const [buttonText, setButtonText] = useState("");
  const [buttonUrl, setButtonUrl] = useState("");
  const [buttonPayload, setButtonPayload] = useState("");

  async function loadActions() {
    const response = await fetch("/api/admin/official/quick-reply-actions", { cache: "no-store" });
    const data = await response.json();
    setActions(data.actions || []);
  }
  async function loadEvents() {
    const response = await fetch("/api/admin/official/quick-reply-events", { cache: "no-store" });
    const data = await response.json();
    setEvents(data.events || []);
  }
  useEffect(() => { loadActions(); loadEvents(); }, []);

  function resetForm() {
    setPayload(""); setButtonLabel(""); setResponseType("text"); setResponseText(""); setCaption(""); setFile(null);
    setHasButton(false); setButtonType("url"); setButtonText(""); setButtonUrl(""); setButtonPayload("");
  }

  async function uploadFile(selected: File) {
    const signedRes = await fetch("/api/admin/official/upload/signed-url", {
      method: "POST",
      body: JSON.stringify({ responseType, file_name: selected.name, mime_type: selected.type, file_size_bytes: selected.size })
    });
    const signed = await signedRes.json();
    if (!signedRes.ok) throw new Error(signed.error || "Falha ao preparar upload.");
    await fetch(signed.signedUrl, { method: "PUT", headers: { "content-type": selected.type }, body: selected });
    await fetch("/api/admin/official/upload/confirm", { method: "POST", body: JSON.stringify({ storage_path: signed.storage_path }) });
    return { bucket: signed.bucket as string, storage_path: signed.storage_path as string, mime_type: selected.type };
  }

  async function saveAction() {
    if (!payload || (responseType === "text" && !responseText) || (responseType !== "text" && !file)) return;
    setSaving(true);
    try {
      let media: { bucket: string; storage_path: string; mime_type: string } | null = null;
      if (file) {
        setUploading(true);
        media = await uploadFile(file);
        setUploading(false);
      }
      const buttonConfig = hasButton && responseType !== "audio"
        ? (buttonType === "url" ? { type: "url", text: buttonText, url: buttonUrl } : { type: "quick_reply", text: buttonText, payload: buttonPayload })
        : null;
      const response = await fetch("/api/admin/official/quick-reply-actions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          payload, buttonLabel: buttonLabel || null, responseType,
          responseText: responseType === "text" ? responseText : null,
          mediaBucket: media?.bucket || null, mediaPath: media?.storage_path || null,
          mimeType: media?.mime_type || null, fileName: file?.name || null,
          caption: responseType !== "text" ? (caption || null) : null,
          buttonConfig, active: true
        })
      });
      const data = await response.json();
      setToast(response.ok ? "Resposta salva." : `Falha: ${data.error || "erro desconhecido"}.`);
      if (response.ok) { setShowForm(false); resetForm(); await loadActions(); }
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Falha ao salvar.");
    } finally {
      setSaving(false);
      setUploading(false);
      setTimeout(() => setToast(""), 4000);
    }
  }

  async function toggleAction(action: QuickReplyAction) {
    const response = await fetch(`/api/admin/official/quick-reply-actions/${action.id}`, {
      method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ active: !action.active })
    });
    if (response.ok) await loadActions();
  }

  return <>
    <section>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-ink">Respostas aos botões</h2>
        <ActionButton icon={<Plus size={16} />} onClick={() => setShowForm((current) => !current)} className="border border-line bg-white text-ink hover:bg-wash">Nova resposta</ActionButton>
      </div>
      <p className="mb-3 text-sm text-muted">Quando o cliente clica num botão Quick Reply de um template, a Disparei envia automaticamente UMA resposta configurada aqui — sem sequência, sem fluxo.</p>

      {showForm ? <div className="mb-4 rounded-lg border border-line bg-panel p-6 shadow-soft">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="text-sm font-medium text-ink">Payload do botão (do template)
            <input value={payload} onChange={(event) => setPayload(event.target.value)} placeholder="access_bonus" className="mt-1 h-11 w-full rounded-lg border border-line px-3" />
          </label>
          <label className="text-sm font-medium text-ink">Rótulo (opcional, só pra organização)
            <input value={buttonLabel} onChange={(event) => setButtonLabel(event.target.value)} placeholder="QUERO ACESSAR" className="mt-1 h-11 w-full rounded-lg border border-line px-3" />
          </label>
          <label className="text-sm font-medium text-ink sm:col-span-2">Tipo da resposta
            <select value={responseType} onChange={(event) => { const value = event.target.value as QuickReplyAction["response_type"]; setResponseType(value); setFile(null); if (value === "audio") setHasButton(false); }} className="mt-1 h-11 w-full rounded-lg border border-line bg-white px-3">
              {RESPONSE_TYPES.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}
            </select>
          </label>
        </div>

        {responseType === "text" ? <label className="mt-4 block text-sm font-medium text-ink">Mensagem
          <textarea value={responseText} onChange={(event) => setResponseText(event.target.value)} rows={4} placeholder={"Perfeito, {{first_name}}! Seu conteúdo está aqui: https://..."} className="mt-1 w-full rounded-lg border border-line px-3 py-2" />
        </label> : <div className="mt-4 space-y-3">
          <div>
            <div className="text-sm font-medium text-ink">{RESPONSE_TYPES.find((type) => type.value === responseType)?.label}</div>
            <div className="mt-1"><FileDropzone onFile={setFile} /></div>
            {file ? <div className="mt-1 text-xs text-muted">{file.name}</div> : null}
          </div>
          {responseType !== "audio" ? <label className="block text-sm font-medium text-ink">Legenda {hasButton ? "(obrigatória com botão)" : "(opcional)"}
            <textarea value={caption} onChange={(event) => setCaption(event.target.value)} rows={2} placeholder={"Seu bônus está aqui, {{first_name}}!"} className="mt-1 w-full rounded-lg border border-line px-3 py-2" />
          </label> : null}
        </div>}

        {responseType !== "audio" ? <div className="mt-4 rounded-lg border border-line bg-wash p-4">
          <label className="flex items-center gap-2 text-sm font-medium text-ink">
            <input type="checkbox" checked={hasButton} onChange={(event) => setHasButton(event.target.checked)} /> Adicionar botão?
          </label>
          {hasButton ? <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="text-sm text-ink">Tipo
              <select value={buttonType} onChange={(event) => setButtonType(event.target.value as "url" | "quick_reply")} className="mt-1 h-10 w-full rounded-lg border border-line bg-white px-3">
                <option value="url">Abrir link</option>
                <option value="quick_reply">Resposta rápida</option>
              </select>
            </label>
            <label className="text-sm text-ink">Texto do botão
              <input value={buttonText} onChange={(event) => setButtonText(event.target.value)} placeholder="ACESSAR CONTEÚDO" className="mt-1 h-10 w-full rounded-lg border border-line px-3" />
            </label>
            {buttonType === "url" ? <label className="text-sm text-ink sm:col-span-2">URL
              <input value={buttonUrl} onChange={(event) => setButtonUrl(event.target.value)} placeholder="https://..." className="mt-1 h-10 w-full rounded-lg border border-line px-3" />
            </label> : <label className="text-sm text-ink sm:col-span-2">Payload
              <input value={buttonPayload} onChange={(event) => setButtonPayload(event.target.value)} placeholder="access_group" className="mt-1 h-10 w-full rounded-lg border border-line px-3" />
            </label>}
          </div> : null}
        </div> : null}

        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={() => { setShowForm(false); resetForm(); }} className="rounded-lg border border-line px-4 py-2 text-sm">Cancelar</button>
          <ActionButton disabled={saving || uploading} onClick={saveAction}>{uploading ? "Enviando arquivo…" : saving ? "Salvando…" : "Salvar"}</ActionButton>
        </div>
      </div> : null}

      <DataTable
        columns={["Botão", "Payload", "Resposta", "Status"]}
        rows={actions.map((action) => [
          action.button_label || "—",
          action.payload,
          RESPONSE_TYPES.find((type) => type.value === action.response_type)?.label || action.response_type,
          <button key="toggle" type="button" onClick={() => toggleAction(action)} className={`rounded-full border px-2.5 py-1 text-xs font-medium ${action.active ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-line bg-wash text-muted"}`}>{action.active ? "Ativo" : "Inativo"}</button>
        ])}
      />
    </section>

    <section>
      <h2 className="mb-3 text-lg font-semibold text-ink">Cliques recebidos</h2>
      {!events.length ? <EmptyState title="Nenhum clique ainda" description="Quando um cliente clicar num botão Quick Reply, aparece aqui." /> : <DataTable
        columns={["Data", "Telefone", "Payload", "Resposta", "Status", "Erro"]}
        rows={events.map((event) => {
          const message = event.official_messages?.[0];
          return [
            new Date(event.created_at).toLocaleString("pt-BR"),
            event.customer_phone || "—",
            event.event_type || "—",
            event.official_quick_reply_actions?.button_label || event.official_quick_reply_actions?.response_type || "—",
            <span key="status" className={`rounded-full border px-2.5 py-1 text-xs font-medium ${event.status === "failed" ? "border-red-200 bg-red-50 text-red-700" : "border-emerald-200 bg-emerald-50 text-emerald-700"}`}>{event.status}</span>,
            message?.error || event.error || "—"
          ];
        })}
      />}
    </section>
    <Toast message={toast} />
  </>;
}
