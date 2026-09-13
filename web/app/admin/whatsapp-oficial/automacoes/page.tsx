"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { ZodError } from "zod";
import { ActionButton, AppShell, ConfirmModal, EmptyState, ErrorState, FileDropzone, LoadingState } from "@/components/ui";
import { Plus, Pencil, Zap, MessageSquare, MousePointerClick, Clock, ArrowUp, ArrowDown, Trash2, Check, ArrowRight } from "lucide-react";
import { ConnectionSelect } from "../connection-select";
import { automationInputSchema, type AutomationInput, type DelayUnit, type FollowupConfig, type FollowupStep } from "@/modules/official-whatsapp/automation-config";
import type { OfficialAutomation } from "@/modules/official-whatsapp/server/automations";
import type { WhatsAppTemplate } from "@/modules/official-whatsapp/server/templates";
import type { QuickReplyAction } from "@/modules/official-whatsapp/server/quick-reply-actions";
import { INTERNAL_VARIABLES, renderTemplateBodyPreview } from "@/modules/official-whatsapp/server/variable-resolver";

const field = "mt-1.5 h-11 w-full rounded-xl border border-line bg-white px-3 text-sm disabled:opacity-60";
const emptyDraft: AutomationInput = { name: "", eventType: "invoice.payment_succeeded", productId: "", productName: "", connectionId: null, templateName: "", templateLanguage: "pt_BR", variableMapping: {}, followupMode: "none", followupConfig: null, followupSteps: [], active: true };
const eventLabels: Record<string, string> = { "invoice.payment_succeeded": "Compra aprovada (Hubla)", "order.paid": "Venda aprovada (ElevaPay)", "invoice.payment_failed": "Pagamento recusado (Hubla)", "invoice.created": "Cobrança criada (Hubla)" };
const sample = { customerName: "Maria Silva", productName: "Seu produto", customerEmail: "cliente@exemplo.com", customerPhone: "5511999999999", amountCents: 9900, paymentUrl: "https://exemplo.com/pagamento", accessUrl: "https://exemplo.com/acesso" };
const unitLabels: Record<DelayUnit, string> = { minutes: "minuto(s)", hours: "hora(s)", days: "dia(s)" };

function newStep(triggerType: "click" | "delay"): FollowupStep {
  return { id: crypto.randomUUID(), trigger: triggerType === "click" ? { type: "click", triggerButtonIndex: "" } : { type: "delay", delayAmount: 10, delayUnit: "minutes" }, responseType: "text", responseText: "", caption: null, mediaBucket: null, mediaPath: null, mimeType: null, fileName: null, buttonConfig: null };
}
function stepFromLegacyConfig(config: FollowupConfig): FollowupStep {
  return { id: crypto.randomUUID(), trigger: { type: "click", triggerButtonIndex: config.triggerButtonIndex }, responseType: config.responseType, responseText: config.responseText, caption: config.caption, mediaBucket: config.mediaBucket, mediaPath: config.mediaPath, mimeType: config.mimeType, fileName: config.fileName, buttonConfig: config.buttonConfig };
}
function resetTriggerIndexes(steps: FollowupStep[]): FollowupStep[] { return steps.map(step => step.trigger.type === "click" ? { ...step, trigger: { ...step.trigger, triggerButtonIndex: "" } } : step); }
function buildVariableMapping(selected?: WhatsAppTemplate): AutomationInput["variableMapping"] {
  const mapping: AutomationInput["variableMapping"] = {};
  if (selected) for (const section of ["header", "body", "buttons"] as const) {
    const keys = section === "buttons" ? selected.dynamicUrlButtonIndexes : selected.parameterFormat === "NAMED" ? selected.namedVariables[section] : Array.from({ length: selected.variables[section] }, (_, i) => String(i + 1));
    mapping[section] = Object.fromEntries(keys.map(key => [key, ""]));
  }
  return mapping;
}
function quickReplyOptions(template?: WhatsAppTemplate): { index: string; text: string }[] {
  const buttons = template?.components.find(item => item.type === "BUTTONS")?.buttons || [];
  const options: { index: string; text: string }[] = [];
  buttons.forEach((button, index) => { if (button.type === "QUICK_REPLY") options.push({ index: String(index), text: button.text || `Botão ${index + 1}` }); });
  return options;
}

function VariableMappingRows({ mapping, onChange }: { mapping: AutomationInput["variableMapping"]; onChange: (next: AutomationInput["variableMapping"]) => void }) {
  return <>{(["header", "body", "buttons"] as const).map(section => Object.entries(mapping[section] || {}).map(([key, value]) => <div key={`${section}-${key}`} className="mt-3 grid gap-2 rounded-xl bg-wash p-3 sm:grid-cols-[110px_1fr]"><span className="self-center text-xs text-muted">{section === "header" ? "Cabeçalho" : section === "body" ? "Mensagem" : "Link"} {`{{${key}}}`}</span><div><select required className={field} value={value.startsWith("static:") ? "static:" : value} onChange={e => onChange({ ...mapping, [section]: { ...mapping[section], [key]: e.target.value } })}><option value="">Selecione o dado</option>{INTERNAL_VARIABLES.map(v => <option key={v.value} value={v.value}>{v.label}</option>)}<option value="static:">Texto fixo</option></select>{value.startsWith("static:") ? <input required className={field} value={value.slice(7)} placeholder="Digite o texto fixo" onChange={e => onChange({ ...mapping, [section]: { ...mapping[section], [key]: `static:${e.target.value}` } })} /> : null}</div></div>))}</>;
}

export default function AutomationsPage() {
  const [automations, setAutomations] = useState<OfficialAutomation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [draft, setDraft] = useState<AutomationInput>(emptyDraft);
  const [templates, setTemplates] = useState<WhatsAppTemplate[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [templatesError, setTemplatesError] = useState("");
  const [saving, setSaving] = useState(false);
  const [stepFiles, setStepFiles] = useState<Record<string, File>>({});
  const [legacyActions, setLegacyActions] = useState<QuickReplyAction[]>([]);
  const [confirmToggle, setConfirmToggle] = useState<OfficialAutomation | null>(null);
  const saveLock = useRef(false);
  const load = useCallback(async () => {
    const response = await fetch("/api/admin/official/automations", { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Não foi possível carregar as automações.");
    setAutomations(data.automations || []);
  }, []);
  useEffect(() => { load().catch((e) => setError(e.message)).finally(() => setLoading(false)); }, [load]);
  useEffect(() => {
    if (!showForm) return;
    let active = true; setTemplatesLoading(true); setTemplates([]); setTemplatesError("");
    fetch(`/api/admin/official/templates?connectionId=${encodeURIComponent(draft.connectionId || "legacy")}`, { cache: "no-store" }).then(async (response) => {
      const data = await response.json(); if (!response.ok) throw new Error(data.error || "Não foi possível carregar modelos.");
      if (active) setTemplates(data.templates || []);
    }).catch((e) => { if (active) setTemplatesError(e.message); }).finally(() => { if (active) setTemplatesLoading(false); });
    return () => { active = false; };
  }, [showForm, draft.connectionId]);
  const template = templates.find((item) => item.name === draft.templateName && item.language === draft.templateLanguage);
  const buttons = template?.components.find((item) => item.type === "BUTTONS")?.buttons || [];
  function close() { setShowForm(false); setEditing(null); setDraft(emptyDraft); setStepFiles({}); setError(""); }
  function edit(automation?: OfficialAutomation) {
    setError(""); setNotice(""); setStepFiles({}); setLegacyActions([]); setEditing(automation?.id || null);
    if (!automation) { setDraft({ ...emptyDraft }); setShowForm(true); return; }
    // Uma automação "button" (segunda mensagem única) abre já convertida na nova tela de
    // sequência, como uma etapa por clique — salvar sem mudanças migra o registro pra "sequence".
    const upgradingFromButton = automation.followup_mode === "button" && automation.followup_config;
    setDraft({
      name: automation.name || automation.product_name || "Automação", eventType: automation.event_type, productId: automation.product_id, productName: automation.product_name,
      connectionId: automation.connection_id, templateName: automation.template_name, templateLanguage: automation.template_language, variableMapping: automation.variable_mapping || {},
      followupMode: upgradingFromButton ? "sequence" : (automation.followup_mode || "legacy"), followupConfig: null,
      followupSteps: upgradingFromButton ? [stepFromLegacyConfig(automation.followup_config as FollowupConfig)] : (automation.followup_steps || []),
      active: automation.active
    });
    setShowForm(true);
    if (automation.followup_mode === "legacy") fetch("/api/admin/official/quick-reply-actions", { cache: "no-store" }).then(r => r.json()).then(data => setLegacyActions(data.actions || [])).catch(() => setError("Não foi possível carregar respostas antigas."));
  }
  function selectTemplate(key: string) {
    const selected = templates.find(item => `${item.name}|${item.language}` === key);
    setDraft(current => ({ ...current, templateName: selected?.name || "", templateLanguage: selected?.language || "pt_BR", variableMapping: buildVariableMapping(selected), followupSteps: resetTriggerIndexes(current.followupSteps) }));
  }
  function handleModeChange(mode: AutomationInput["followupMode"]) {
    setDraft(current => mode === "sequence"
      ? { ...current, followupMode: "sequence", followupConfig: null, followupSteps: current.followupSteps.length ? current.followupSteps : [newStep("click")] }
      : { ...current, followupMode: mode, followupConfig: null, followupSteps: [] });
  }
  function addStep(triggerType: "click" | "delay") {
    setDraft(current => ({ ...current, followupMode: "sequence", followupSteps: resetTriggerIndexes([...current.followupSteps, newStep(triggerType)]) }));
  }
  function removeStep(id: string) {
    setDraft(current => ({ ...current, followupSteps: resetTriggerIndexes(current.followupSteps.filter(step => step.id !== id)) }));
    setStepFiles(current => { const next = { ...current }; delete next[id]; return next; });
  }
  function moveStep(id: string, direction: -1 | 1) {
    setDraft(current => {
      const steps = [...current.followupSteps];
      const index = steps.findIndex(step => step.id === id);
      const target = index + direction;
      if (index === -1 || target < 0 || target >= steps.length) return current;
      [steps[index], steps[target]] = [steps[target], steps[index]];
      return { ...current, followupSteps: resetTriggerIndexes(steps) };
    });
  }
  function setStepTriggerType(id: string, triggerType: "click" | "delay") {
    // Troca só o gatilho — o conteúdo já escrito (texto/mídia/botão) é mantido.
    setDraft(current => ({ ...current, followupSteps: resetTriggerIndexes(current.followupSteps.map(step => step.id === id ? { ...step, trigger: triggerType === "click" ? { type: "click", triggerButtonIndex: "" } : { type: "delay", delayAmount: 10, delayUnit: "minutes" } } : step)) }));
  }
  function patchStep(id: string, changes: Partial<FollowupStep>) {
    setDraft(current => ({ ...current, followupSteps: current.followupSteps.map(step => step.id === id ? ({ ...step, ...changes } as FollowupStep) : step) }));
  }
  function patchStepDelay(id: string, changes: { delayAmount?: number; delayUnit?: DelayUnit }) {
    setDraft(current => ({ ...current, followupSteps: current.followupSteps.map(step => step.id === id && step.trigger.type === "delay" ? { ...step, trigger: { ...step.trigger, ...changes } } : step) }));
  }
  function previousButtonOptions(index: number): { index: string; text: string }[] {
    if (index === 0) return quickReplyOptions(template);
    const previous = draft.followupSteps[index - 1];
    return previous?.buttonConfig?.type === "quick_reply" ? [{ index: "0", text: previous.buttonConfig.text || "Continuar" }] : [];
  }
  async function uploadStepFile(selected: File, responseType: FollowupStep["responseType"]) {
    const signedRes = await fetch("/api/admin/official/upload/signed-url", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ responseType, file_name: selected.name, mime_type: selected.type, file_size_bytes: selected.size }) });
    const signed = await signedRes.json(); if (!signedRes.ok) throw new Error(signed.error || "Falha ao preparar arquivo.");
    const uploaded = await fetch(signed.signedUrl, { method: "PUT", headers: { "content-type": selected.type }, body: selected });
    if (!uploaded.ok) throw new Error("Upload não concluído. Tente novamente.");
    const confirmed = await fetch("/api/admin/official/upload/confirm", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ storage_path: signed.storage_path }) });
    if (!confirmed.ok) throw new Error("Não foi possível confirmar o arquivo.");
    return { mediaBucket: signed.bucket, mediaPath: signed.storage_path, mimeType: selected.type, fileName: selected.name };
  }
  async function save(event: React.FormEvent) {
    event.preventDefault(); if (saveLock.current) return; saveLock.current = true; setSaving(true); setError("");
    try {
      const steps = await Promise.all(draft.followupSteps.map(async (step) => {
        if (step.responseType !== "text" && stepFiles[step.id]) return { ...step, ...(await uploadStepFile(stepFiles[step.id], step.responseType)) };
        return step;
      }));
      const input = automationInputSchema.parse({ ...draft, followupConfig: null, followupSteps: steps });
      const response = await fetch(editing ? `/api/admin/official/automations/${editing}` : "/api/admin/official/automations", { method: editing ? "PATCH" : "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || "Falha ao salvar.");
      close(); setNotice("Automação salva. Nenhuma mensagem de teste foi enviada."); await load();
    } catch (e) { setError(e instanceof ZodError ? e.issues.map(issue => issue.message).join(" ") : e instanceof Error ? e.message : "Não foi possível salvar."); }
    finally { setSaving(false); saveLock.current = false; }
  }
  async function toggle() {
    if (!confirmToggle || saveLock.current) return; saveLock.current = true; setSaving(true); setError("");
    try {
      const response = await fetch(`/api/admin/official/automations/${confirmToggle.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ active: !confirmToggle.active }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || "Falha ao atualizar.");
      setConfirmToggle(null); await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Falha ao atualizar."); }
    finally { setSaving(false); saveLock.current = false; }
  }
  const bodyPreview = template ? renderTemplateBodyPreview(template.components.find(item => item.type === "BODY")?.text || "", draft.variableMapping.body, { ...sample, productName: draft.productName || sample.productName }, template.parameterFormat) : "Escolha um modelo aprovado para visualizar a mensagem inicial.";
  function stepPreviewBubble(step: FollowupStep) {
    return <div className="rounded-xl border border-emerald-100 bg-emerald-50 p-4 text-sm"><p className="whitespace-pre-wrap">{step.responseType === "text" ? step.responseText || "Escreva a mensagem…" : `${stepFiles[step.id]?.name || step.fileName || step.responseType}\n${step.caption || ""}`}</p>{step.buttonConfig ? <div className="mt-3 rounded-lg bg-white p-2 text-center font-medium text-emerald-800">{step.buttonConfig.text || "Botão"}</div> : null}</div>;
  }

  return <AppShell title="Automações" subtitle="Compra aprovada e outros eventos: configure a conversa inteira aqui.">
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4"><div><h2 className="text-xl font-semibold">Do evento à próxima mensagem</h2><p className="mt-1 text-sm text-muted">Cada produto tem sua configuração. Não é preciso criar um fluxo separado.</p></div>{!showForm ? <ActionButton icon={<Plus size={16} />} onClick={() => edit()}>Nova automação</ActionButton> : null}</div>
      {error ? <ErrorState message={error} /> : null}{notice ? <div role="status" className="rounded-xl bg-emerald-50 p-4 text-sm text-emerald-800">{notice}</div> : null}
      {loading ? <LoadingState /> : null}
      {showForm ? <form onSubmit={save} className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <fieldset disabled={saving} className="min-w-0 space-y-5">
          <section className="rounded-2xl border border-line bg-panel p-6"><h3 className="flex items-center gap-2 font-semibold"><Zap size={18} /> 1. Quando acontece</h3>
            <div className="mt-4 grid gap-4 sm:grid-cols-2"><label className="text-sm font-medium sm:col-span-2">Nome da automação<input required value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} placeholder="Compra aprovada · Achadinhos Ads" className={field} /></label>
              <label className="text-sm font-medium">Evento<select className={field} value={eventLabels[draft.eventType] ? draft.eventType : "custom"} onChange={e => setDraft({ ...draft, eventType: e.target.value === "custom" ? "" : e.target.value })}>{Object.entries(eventLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}<option value="custom">Outro evento</option></select>{!eventLabels[draft.eventType] ? <input required value={draft.eventType} onChange={e => setDraft({ ...draft, eventType: e.target.value })} placeholder="Nome exato recebido pelo webhook" className={field} /> : null}</label>
              <label className="text-sm font-medium">Nome do produto<input value={draft.productName || ""} onChange={e => setDraft({ ...draft, productName: e.target.value })} placeholder="Achadinhos Ads" className={field} /></label>
              <label className="text-sm font-medium sm:col-span-2">ID do produto<input required={draft.productId !== null} disabled={draft.productId === null} value={draft.productId || ""} onChange={e => setDraft({ ...draft, productId: e.target.value })} placeholder="Cole o ID do produto" className={field} /><span className="mt-2 block text-xs font-normal text-muted">O ID identifica o produto; o nome serve para organização.</span></label>
              <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={draft.productId === null} onChange={e => setDraft({ ...draft, productId: e.target.checked ? null : "" })} /> Usar como padrão para produtos sem automação específica</label>
              <div className="sm:col-span-2"><ConnectionSelect value={draft.connectionId || "legacy"} disabled={saving} onChange={value => setDraft({ ...draft, connectionId: value === "legacy" ? null : value, templateName: "", variableMapping: {}, followupMode: "none", followupConfig: null, followupSteps: [] })} /></div>
            </div>
          </section>
          <section className="rounded-2xl border border-line bg-panel p-6"><h3 className="flex items-center gap-2 font-semibold"><MessageSquare size={18} /> 2. Mensagem inicial</h3><p className="mt-1 text-sm text-muted">Enviada quando o evento do produto é recebido.</p>
            {templatesError ? <div className="mt-3"><ErrorState message={templatesError} /></div> : null}
            <label className="mt-4 block text-sm font-medium">Modelo aprovado<select required disabled={templatesLoading} value={draft.templateName ? `${draft.templateName}|${draft.templateLanguage}` : ""} onChange={e => selectTemplate(e.target.value)} className={field}><option value="">{templatesLoading ? "Carregando modelos…" : "Escolha um modelo"}</option>{draft.templateName && !template ? <option value={`${draft.templateName}|${draft.templateLanguage}`}>{draft.templateName} · aguardando validação</option> : null}{templates.filter(t => t.status === "APPROVED").map(t => <option key={`${t.name}|${t.language}`} value={`${t.name}|${t.language}`}>{t.name} · {t.language}</option>)}</select></label>
            <VariableMappingRows mapping={draft.variableMapping} onChange={(next) => setDraft({ ...draft, variableMapping: next })} />
          </section>
          <section className="rounded-2xl border border-line bg-panel p-6"><h3 className="flex items-center gap-2 font-semibold"><MousePointerClick size={18} /> 3. Mensagens de acompanhamento</h3>
            <select aria-label="Quando enviar mensagens de acompanhamento" value={draft.followupMode} onChange={e => handleModeChange(e.target.value as AutomationInput["followupMode"])} className={field}>{editing && automations.find(a => a.id === editing)?.followup_mode === "legacy" ? <option value="legacy">Manter resposta antiga por enquanto</option> : null}<option value="none">Enviar somente a mensagem inicial</option><option value="sequence">Adicionar mensagens de acompanhamento</option></select>
            <p className="mt-2 text-xs leading-5 text-muted">Encadeie quantas mensagens quiser: cada uma dispara quando o cliente clica num botão da anterior, ou depois de um tempo, sem esperar clique.</p>
            {draft.followupMode === "legacy" ? <div className="mt-4 rounded-xl bg-amber-50 p-4 text-sm text-amber-900">A configuração antiga continua funcionando. Para separar a resposta deste produto, escolha “Adicionar mensagens de acompanhamento” e configure abaixo. Isso vale para novos envios; mensagens já enviadas mantêm o comportamento antigo.</div> : null}
            {draft.followupMode === "sequence" ? <div className="mt-4 space-y-5">
              {draft.followupSteps.map((step, index) => {
                const options = previousButtonOptions(index);
                const isLastStep = index === draft.followupSteps.length - 1;
                return <div key={step.id} className="space-y-4 rounded-xl border border-line bg-wash p-4">
                  <div className="flex items-center justify-between gap-2"><span className="text-sm font-semibold">Etapa {index + 1}</span>
                    <div className="flex items-center gap-1">
                      <button type="button" disabled={index === 0} onClick={() => moveStep(step.id, -1)} className="rounded-lg p-1.5 disabled:opacity-30" aria-label="Mover etapa para cima"><ArrowUp size={16} /></button>
                      <button type="button" disabled={isLastStep} onClick={() => moveStep(step.id, 1)} className="rounded-lg p-1.5 disabled:opacity-30" aria-label="Mover etapa para baixo"><ArrowDown size={16} /></button>
                      <button type="button" onClick={() => removeStep(step.id)} className="rounded-lg p-1.5 text-red-600" aria-label="Remover etapa"><Trash2 size={16} /></button>
                    </div>
                  </div>
                  <label className="block text-sm font-medium">Como esta etapa é enviada?<select className={field} value={step.trigger.type} onChange={e => setStepTriggerType(step.id, e.target.value as "click" | "delay")}><option value="click">Quando o cliente clicar num botão da mensagem anterior</option><option value="delay">Depois de um tempo, sem esperar clique</option></select></label>
                  {step.trigger.type === "click" ? <>
                    <label className="block text-sm font-medium">Qual botão da mensagem anterior?<select required className={field} value={step.trigger.triggerButtonIndex} onChange={e => patchStep(step.id, { trigger: { type: "click", triggerButtonIndex: e.target.value } })}><option value="">Selecione o botão</option>{options.map(option => <option key={option.index} value={option.index}>{option.text}</option>)}</select></label>
                    {!options.length ? <p className="text-sm text-amber-800">A mensagem anterior não tem botão de resposta rápida disponível. Ajuste-a ou remova esta etapa.</p> : null}
                  </> : <>
                    <label className="block text-sm font-medium">Esperar<div className="mt-1.5 grid grid-cols-[100px_1fr] gap-3"><input required type="number" min={1} max={999} value={step.trigger.delayAmount} onChange={e => patchStepDelay(step.id, { delayAmount: Number(e.target.value) })} className={field} /><select className={field} value={step.trigger.delayUnit} onChange={e => patchStepDelay(step.id, { delayUnit: e.target.value as DelayUnit })}><option value="minutes">Minutos</option><option value="hours">Horas</option><option value="days">Dias</option></select></div></label>
                    <p className="text-sm text-amber-800">Sem clique do cliente antes, a Meta pode recusar o envio por falta de janela de atendimento aberta.</p>
                  </>}
                  {index === 0 && editing && legacyActions.length ? <label className="block text-sm text-muted">Copiar uma resposta antiga (opcional)<select className={field} defaultValue="" onChange={e => { const action = legacyActions.find(a => a.id === e.target.value); if (action) patchStep(step.id, { responseType: action.response_type, responseText: action.response_text, caption: action.caption, mediaBucket: action.media_bucket as "whatsapp-media" | null, mediaPath: action.media_path, mimeType: action.mime_type, fileName: action.file_name, buttonConfig: action.button_config?.type === "url" ? action.button_config : null }); }}><option value="">Não copiar</option>{legacyActions.map(action => <option key={action.id} value={action.id}>{action.button_label || action.payload} · {action.response_type}</option>)}</select><span className="text-xs">Cria uma cópia independente; não altera a resposta antiga.</span></label> : null}
                  <label className="block text-sm font-medium">Conteúdo<select value={step.responseType} className={field} onChange={e => { setStepFiles(current => { const next = { ...current }; delete next[step.id]; return next; }); patchStep(step.id, { responseType: e.target.value as FollowupStep["responseType"], mediaBucket: null, mediaPath: null, mimeType: null, fileName: null, buttonConfig: null }); }}>{Object.entries({ text: "Texto", image: "Imagem", video: "Vídeo", audio: "Áudio", document: "Documento" }).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
                  {step.responseType === "text" ? <label className="block text-sm font-medium">Mensagem<textarea required rows={5} value={step.responseText || ""} onChange={e => patchStep(step.id, { responseText: e.target.value })} placeholder="Seu acesso está pronto, {{first_name}}!" className="mt-2 w-full rounded-xl border border-line p-3 text-sm" /></label> : <div><FileDropzone onFile={(selectedFile) => setStepFiles(current => ({ ...current, [step.id]: selectedFile }))} /><p className="mt-2 text-xs text-muted">{stepFiles[step.id]?.name || step.fileName || "Selecione o arquivo"}</p>{step.responseType !== "audio" ? <label className="mt-3 block text-sm font-medium">Legenda<textarea rows={3} value={step.caption || ""} onChange={e => patchStep(step.id, { caption: e.target.value })} className="mt-2 w-full rounded-xl border border-line p-3 text-sm" /></label> : null}</div>}
                  <p className="text-xs text-muted">Personalize com {"{{first_name}}"}, {"{{product_name}}"} ou {"{{access_url}}"}. Os dados são os da compra original.</p>
                  {step.responseType !== "audio" ? <div className="rounded-xl bg-white p-4"><span className="mb-2 block text-sm font-medium">Botão</span>
                    <div className="flex flex-wrap gap-4 text-sm">
                      <label className="flex items-center gap-2"><input type="radio" name={`button-${step.id}`} checked={!step.buttonConfig} onChange={() => patchStep(step.id, { buttonConfig: null })} /> Nenhum</label>
                      <label className="flex items-center gap-2"><input type="radio" name={`button-${step.id}`} checked={step.buttonConfig?.type === "url"} onChange={() => patchStep(step.id, { buttonConfig: { type: "url", text: "ACESSAR", url: "" } })} /> Abrir link</label>
                      <label className="flex items-center gap-2"><input type="radio" name={`button-${step.id}`} checked={step.buttonConfig?.type === "quick_reply"} onChange={() => patchStep(step.id, { buttonConfig: { type: "quick_reply", text: "CONTINUAR" } })} /> Continuar a sequência</label>
                    </div>
                    {step.buttonConfig?.type === "quick_reply" && isLastStep ? <p className="mt-2 text-sm text-amber-800">Adicione uma próxima etapa por clique para usar este botão.</p> : null}
                    {step.buttonConfig ? <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      <label className="text-sm">Texto do botão<input required maxLength={20} value={step.buttonConfig.text} onChange={e => patchStep(step.id, { buttonConfig: { ...step.buttonConfig!, text: e.target.value } })} className={field} /></label>
                      {step.buttonConfig.type === "url" ? <label className="text-sm">Link de destino<input required type="url" value={step.buttonConfig.url} onChange={e => patchStep(step.id, { buttonConfig: { type: "url", text: step.buttonConfig!.text, url: e.target.value } })} placeholder="https://..." className={field} /></label> : null}
                    </div> : null}
                  </div> : null}
                </div>;
              })}
              <div className="flex flex-wrap gap-3">
                <ActionButton type="button" icon={<MousePointerClick size={16} />} onClick={() => addStep("click")}>Etapa por clique</ActionButton>
                <ActionButton type="button" icon={<Clock size={16} />} onClick={() => addStep("delay")}>Etapa por tempo</ActionButton>
              </div>
            </div> : null}
          </section>
          <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-line bg-white p-4"><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={draft.active} onChange={e => setDraft({ ...draft, active: e.target.checked })} /> Ativa para novos eventos</label><div className="flex gap-3"><button type="button" onClick={close} className="px-3 text-sm">Cancelar</button><ActionButton type="submit" disabled={templatesLoading || !template} icon={<Check size={16} />}>{saving ? "Salvando…" : "Salvar automação"}</ActionButton></div></div>
        </fieldset>
        <aside className="space-y-4 rounded-2xl border border-line bg-wash p-5 xl:sticky xl:top-28"><h3 className="font-semibold">Prévia da conversa</h3><p className="text-xs text-muted">Exemplo ilustrativo. Nenhuma mensagem será enviada ao salvar.</p><div className="rounded-xl bg-white p-4 text-sm"><span className="text-xs text-muted">{eventLabels[draft.eventType] || draft.eventType || "Evento"} · {draft.productName || "Seu produto"}</span><p className="mt-3 whitespace-pre-wrap">{bodyPreview}</p>{draft.followupSteps[0]?.trigger.type === "click" && draft.followupSteps[0].trigger.triggerButtonIndex !== "" ? <div className="mt-3 border-t border-line pt-3 text-center font-medium text-emerald-700">{buttons[Number(draft.followupSteps[0].trigger.triggerButtonIndex)]?.text}</div> : null}</div>
          {draft.followupSteps.length ? draft.followupSteps.map(step => <div key={step.id} className="space-y-2">
            <div className="flex items-center justify-center gap-2 text-xs text-muted">{step.trigger.type === "click" ? <MousePointerClick size={14} /> : <Clock size={14} />} {step.trigger.type === "click" ? "Aguarda o clique do cliente" : `Aguarda ${step.trigger.delayAmount} ${unitLabels[step.trigger.delayUnit]}`}</div>
            {stepPreviewBubble(step)}
          </div>) : <p className="text-sm text-muted">{draft.followupMode === "legacy" ? "Resposta antiga preservada até você revisar." : "A conversa automática termina na primeira mensagem."}</p>}
        </aside>
      </form> : !loading ? <div className="space-y-4">{!automations.length ? <EmptyState title="Sua primeira automação" description="Comece por compra aprovada: escolha o produto, o modelo e a resposta ao clique." /> : automations.map(automation => <section key={automation.id} className="rounded-2xl border border-line bg-panel p-5 shadow-soft"><div className="flex flex-wrap items-start justify-between gap-4"><div><h3 className="font-semibold">{automation.name || automation.product_name || "Automação"}</h3><p className="mt-1 text-sm text-muted">{eventLabels[automation.event_type] || automation.event_type} · {automation.product_name || automation.product_id || "Padrão para todos os produtos"}</p></div><span className={`rounded-full px-3 py-1 text-xs ${automation.active ? "bg-emerald-50 text-emerald-700" : "bg-wash text-muted"}`}>{automation.active ? "Ativa" : "Pausada"}</span></div><div className="my-4 flex flex-wrap items-center gap-2 rounded-xl bg-wash p-3 text-sm"><span>{automation.template_name}</span><ArrowRight size={14} /><span>{automation.followup_mode === "sequence" ? `${automation.followup_steps?.length || 0} mensagem(ns) encadeada(s)` : automation.followup_mode === "button" ? "Clique do cliente → segunda mensagem própria" : automation.followup_mode === "none" ? "Somente mensagem inicial" : "Resposta antiga · revisar organização"}</span></div><div className="flex gap-4"><button type="button" onClick={() => edit(automation)} className="inline-flex items-center gap-2 text-sm font-medium"><Pencil size={14} /> Editar conversa completa</button><button type="button" onClick={() => setConfirmToggle(automation)} className="text-sm text-muted">{automation.active ? "Pausar" : "Ativar"}</button></div></section>)}</div> : null}
      <p className="text-sm text-muted">Para enviar uma lista manualmente, use <Link href="/admin/whatsapp-oficial/disparos" className="font-medium underline">Disparos 1 a 1</Link>. O webhook da Hubla fica em <Link href="/admin/whatsapp-oficial/configuracoes" className="underline">Configurações da API</Link>.</p>
    </div>
    <ConfirmModal open={Boolean(confirmToggle)} title={confirmToggle?.active ? "Pausar automação?" : "Ativar automação?"} onCancel={() => setConfirmToggle(null)} onConfirm={toggle} loading={saving} confirmLabel="Confirmar">A alteração vale para novos eventos e para etapas por tempo ainda não disparadas. Mensagens já enviadas ou aguardando clique mantêm a resposta configurada no momento do envio.</ConfirmModal>
  </AppShell>;
}
