"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ActionButton, AppShell, ConfirmModal, DataTable, EmptyState, ErrorState, FileDropzone } from "@/components/ui";
import { ArrowLeft, Calendar, FileSpreadsheet, Send } from "lucide-react";
import { ConnectionSelect } from "../connection-select";

type FieldMapping = { mode: "column" | "fixed" | "none"; column: string; fixedValue: string };
type Flow = { id: string; name: string; initial_template_name: string; initial_template_language: string; active: boolean; official_quick_reply_actions: { button_label: string | null; payload: string } };
type PreviewResult = {
  totalRows: number; validCount: number; duplicateCount: number; invalidCount: number;
  previewContacts: Array<{ name: string | null; text: string }>;
  flow: { name: string; templateName: string; templateCategory: string; buttonLabel: string | null };
};

type BroadcastSummary = { id: string; name: string; status: string; total_rows: number; accepted: number; failed: number; processed: number; created_at: string; scheduled_at: string | null; delivery_speed: "standard" | "urgent"; official_flows: { name: string } | null; official_connections: { label: string } | null };

const emptyMapping: FieldMapping = { mode: "none", column: "", fixedValue: "" };
const STATUS_LABELS: Record<string, string> = { draft: "Rascunho", ready: "Pronto", scheduled: "Agendado", processing: "Em andamento", paused: "Pausado", completed: "Concluído", failed: "Falhou", cancelled: "Cancelado" };

function scheduledAtToIso(date: string, time: string) {
  if (!date || !time) return null;
  const parsed = new Date(`${date}T${time}:00-03:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function formatBrasilia(iso: string) {
  return new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" });
}

export default function DisparosPage() {
  const router = useRouter();
  const [broadcasts, setBroadcasts] = useState<BroadcastSummary[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [parsing, setParsing] = useState(false);
  const [parseError, setParseError] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<string[][]>([]);

  const [phoneColumn, setPhoneColumn] = useState("");
  const [nameMapping, setNameMapping] = useState<FieldMapping>(emptyMapping);
  const [emailMapping, setEmailMapping] = useState<FieldMapping>(emptyMapping);
  const [productMapping, setProductMapping] = useState<FieldMapping>(emptyMapping);

  const [flows, setFlows] = useState<Flow[]>([]);
  const [flowsLoaded, setFlowsLoaded] = useState(false);
  const [selectedFlowId, setSelectedFlowId] = useState("");
  const [connectionId, setConnectionId] = useState("legacy");

  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState("");

  const [broadcastName, setBroadcastName] = useState("");
  const [deliverySpeed, setDeliverySpeed] = useState<"standard" | "urgent">("standard");
  const [sendMode, setSendMode] = useState<"agora" | "agendar">("agora");
  const [scheduleDate, setScheduleDate] = useState("");
  const [scheduleTime, setScheduleTime] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState("");
  const [cancelingId, setCancelingId] = useState("");

  const scheduledAtIso = sendMode === "agendar" ? scheduledAtToIso(scheduleDate, scheduleTime) : null;

  async function loadBroadcasts() {
    const response = await fetch("/api/admin/official/broadcasts", { cache: "no-store" });
    const data = await response.json();
    setBroadcasts(data.broadcasts || []);
  }
  useEffect(() => { loadBroadcasts(); }, []);

  async function loadFlows() {
    const response = await fetch("/api/admin/official/flows", { cache: "no-store" });
    const data = await response.json();
    setFlows((data.flows || []).filter((flow: Flow) => flow.active));
    setFlowsLoaded(true);
  }

  async function handleFile(selected: File) {
    setFile(selected);
    setParsing(true);
    setParseError("");
    setPreview(null);
    try {
      const formData = new FormData();
      formData.append("file", selected);
      const response = await fetch("/api/admin/official/broadcasts/parse", { method: "POST", body: formData });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Falha ao ler o arquivo.");
      setHeaders(data.headers || []);
      setRows(data.rows || []);
      setPhoneColumn(""); setNameMapping(emptyMapping); setEmailMapping(emptyMapping); setProductMapping(emptyMapping);
      if (!flowsLoaded) await loadFlows();
    } catch (error) {
      setParseError(error instanceof Error ? error.message : "Falha ao ler o arquivo.");
    } finally {
      setParsing(false);
    }
  }

  function fieldValue(mapping: FieldMapping, row: string[]): string | null {
    if (mapping.mode === "fixed") return mapping.fixedValue || null;
    if (mapping.mode === "column" && mapping.column) {
      const index = headers.indexOf(mapping.column);
      return index >= 0 ? (row[index] || "").trim() || null : null;
    }
    return null;
  }

  async function generatePreview() {
    if (!phoneColumn || !selectedFlowId) return;
    setPreviewing(true);
    setPreviewError("");
    try {
      const phoneIndex = headers.indexOf(phoneColumn);
      const contacts = rows.map((row) => ({
        phone: row[phoneIndex] || "",
        name: fieldValue(nameMapping, row),
        email: fieldValue(emailMapping, row),
        product: fieldValue(productMapping, row)
      }));
      const response = await fetch("/api/admin/official/broadcasts/preview", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ flowId: selectedFlowId, contacts, connectionId })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Falha ao gerar preview.");
      setPreview(data);
    } catch (error) {
      setPreviewError(error instanceof Error ? error.message : "Falha ao gerar preview.");
    } finally {
      setPreviewing(false);
    }
  }

  async function startBroadcast() {
    if (!phoneColumn || !selectedFlowId || !broadcastName.trim() || starting) return;
    if (sendMode === "agendar" && (!scheduledAtIso || new Date(scheduledAtIso).getTime() < Date.now())) {
      setStartError("Escolha uma data e horário futuros para o agendamento.");
      setConfirming(false);
      return;
    }
    setStarting(true);
    setStartError("");
    try {
      const phoneIndex = headers.indexOf(phoneColumn);
      const contacts = rows.map((row) => ({
        phone: row[phoneIndex] || "",
        name: fieldValue(nameMapping, row),
        email: fieldValue(emailMapping, row),
        product: fieldValue(productMapping, row)
      }));
      const response = await fetch("/api/admin/official/broadcasts", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: broadcastName.trim(), flowId: selectedFlowId, contacts, deliverySpeed, connectionId, scheduledAt: scheduledAtIso || undefined })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Falha ao iniciar disparo.");
      router.push(`/admin/whatsapp-oficial/disparos/${data.broadcastId}`);
    } catch (error) {
      setStartError(error instanceof Error ? error.message : "Falha ao iniciar disparo.");
      setConfirming(false);
      setStarting(false);
    }
  }

  async function cancelBroadcast(id: string) {
    setCancelingId(id);
    try {
      const response = await fetch(`/api/admin/official/broadcasts/${id}/cancel`, { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Falha ao cancelar agendamento.");
      await loadBroadcasts();
    } finally {
      setCancelingId("");
    }
  }

  function FieldMappingRow({ label, mapping, onChange }: { label: string; mapping: FieldMapping; onChange: (value: FieldMapping) => void }) {
    return <div className="grid gap-2 sm:grid-cols-[140px_140px_1fr] sm:items-center">
      <span className="text-sm font-medium text-ink">{label}</span>
      <select value={mapping.mode} onChange={(event) => onChange({ ...mapping, mode: event.target.value as FieldMapping["mode"] })} className="h-10 rounded-lg border border-line bg-white px-2 text-sm">
        <option value="none">Nenhum</option>
        <option value="column">Usar coluna</option>
        <option value="fixed">Valor fixo</option>
      </select>
      {mapping.mode === "column" ? <select value={mapping.column} onChange={(event) => onChange({ ...mapping, column: event.target.value })} className="h-10 rounded-lg border border-line bg-white px-2 text-sm">
        <option value="">Selecione a coluna…</option>
        {headers.map((header) => <option key={header} value={header}>{header}</option>)}
      </select> : mapping.mode === "fixed" ? <input value={mapping.fixedValue} onChange={(event) => onChange({ ...mapping, fixedValue: event.target.value })} placeholder="Valor fixo para todos" className="h-10 rounded-lg border border-line px-3 text-sm" /> : <span />}
    </div>;
  }

  return <AppShell title="Disparos 1 a 1" subtitle="Escolha a conta, envie sua lista e selecione um fluxo. Automações de compra não são usadas aqui.">
    <div className="space-y-6">
      <Link href="/admin/whatsapp-oficial/fluxos" className="inline-flex items-center gap-2 text-sm text-muted hover:text-ink"><ArrowLeft size={15} /> Fluxos</Link>
      <section className="rounded-xl border border-line bg-panel p-5 shadow-soft"><ConnectionSelect value={connectionId} disabled={starting || previewing || confirming} onChange={(value) => { setConnectionId(value); setPreview(null); setPreviewError(""); }} /></section>

      {broadcasts.length ? <section>
        <h2 className="mb-3 text-lg font-semibold text-ink">Histórico</h2>
        <DataTable
          columns={["Data", "Nome", "Conta", "Fluxo", "Ritmo", "Contatos", "Aceitos", "Falharam", "Status", ""]}
          rows={broadcasts.map((broadcast) => [
            broadcast.status === "scheduled" && broadcast.scheduled_at
              ? <span key="date" className="text-amber-700">Agendado: {formatBrasilia(broadcast.scheduled_at)}</span>
              : new Date(broadcast.created_at).toLocaleString("pt-BR"),
            <Link key="name" href={`/admin/whatsapp-oficial/disparos/${broadcast.id}`} className="font-medium text-ink hover:underline">{broadcast.name}</Link>,
            broadcast.official_connections?.label || "Conta principal",
            broadcast.official_flows?.name || "—",
            broadcast.delivery_speed === "urgent" ? "Urgente (até 60x)" : "Padrão (5x)",
            broadcast.total_rows,
            broadcast.accepted,
            broadcast.failed,
            <span key="status" className={`rounded-full border px-2.5 py-1 text-xs font-medium ${broadcast.status === "failed" ? "border-red-200 bg-red-50 text-red-700" : broadcast.status === "completed" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : broadcast.status === "scheduled" ? "border-amber-200 bg-amber-50 text-amber-700" : "border-line bg-wash text-muted"}`}>{STATUS_LABELS[broadcast.status] || broadcast.status}</span>,
            broadcast.status === "scheduled" ? <button key="cancel" type="button" disabled={cancelingId === broadcast.id} onClick={() => cancelBroadcast(broadcast.id)} className="text-xs font-medium text-red-700 hover:underline disabled:opacity-50">{cancelingId === broadcast.id ? "Cancelando…" : "Cancelar"}</button> : null
          ])}
        />
      </section> : null}

      <section className="rounded-lg border border-line bg-panel p-6 shadow-soft">
        <h2 className="text-lg font-semibold text-ink">1. Enviar lista</h2>
        <p className="mt-1 text-sm text-muted">Aceita .csv e .xlsx. Não precisa seguir um modelo fixo — a primeira linha vira os cabeçalhos.</p>
        <div className="mt-4"><FileDropzone onFile={handleFile} /></div>
        {parsing ? <p className="mt-2 text-sm text-muted">Lendo arquivo…</p> : null}
        {parseError ? <div className="mt-3"><ErrorState message={parseError} /></div> : null}
        {file && !parsing && !parseError && rows.length ? <p className="mt-3 text-sm text-ink">{rows.length.toLocaleString("pt-BR")} linhas encontradas em {headers.length} colunas.</p> : null}
      </section>

      {headers.length ? <section className="rounded-lg border border-line bg-panel p-6 shadow-soft">
        <h2 className="text-lg font-semibold text-ink">2. Mapear colunas</h2>
        <div className="mt-4 space-y-4">
          <div className="grid gap-2 sm:grid-cols-[140px_1fr] sm:items-center">
            <span className="text-sm font-medium text-ink">Telefone *</span>
            <select value={phoneColumn} onChange={(event) => setPhoneColumn(event.target.value)} className="h-10 rounded-lg border border-line bg-white px-2 text-sm">
              <option value="">Selecione a coluna…</option>
              {headers.map((header) => <option key={header} value={header}>{header}</option>)}
            </select>
          </div>
          <FieldMappingRow label="Nome" mapping={nameMapping} onChange={setNameMapping} />
          <FieldMappingRow label="E-mail" mapping={emailMapping} onChange={setEmailMapping} />
          <FieldMappingRow label="Produto" mapping={productMapping} onChange={setProductMapping} />
        </div>

        <h2 className="mt-6 text-lg font-semibold text-ink">3. Escolher fluxo</h2>
        <select value={selectedFlowId} onChange={(event) => setSelectedFlowId(event.target.value)} className="mt-3 h-11 w-full max-w-md rounded-lg border border-line bg-white px-3 text-sm">
          <option value="">Selecione…</option>
          {flows.map((flow) => <option key={flow.id} value={flow.id}>{flow.name} ({flow.initial_template_name})</option>)}
        </select>
        {!flows.length && flowsLoaded ? <p className="mt-2 text-sm text-red-700">Nenhum fluxo ativo. Crie um em &quot;Fluxos&quot; primeiro.</p> : null}

        <ActionButton icon={<FileSpreadsheet size={16} />} disabled={!phoneColumn || !selectedFlowId || previewing} onClick={generatePreview} className="mt-6">{previewing ? "Gerando…" : "Gerar preview"}</ActionButton>
        {previewError ? <div className="mt-3"><ErrorState message={previewError} /></div> : null}
      </section> : null}

      {preview ? <section className="rounded-lg border border-line bg-panel p-6 shadow-soft">
        <h2 className="text-lg font-semibold text-ink">Preview</h2>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-lg border border-line bg-wash p-3"><div className="text-xs text-muted">Total de linhas</div><div className="text-lg font-semibold text-ink">{preview.totalRows.toLocaleString("pt-BR")}</div></div>
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3"><div className="text-xs text-emerald-700">Contatos válidos</div><div className="text-lg font-semibold text-emerald-700">{preview.validCount.toLocaleString("pt-BR")}</div></div>
          <div className="rounded-lg border border-line bg-wash p-3"><div className="text-xs text-muted">Duplicados removidos</div><div className="text-lg font-semibold text-ink">{preview.duplicateCount.toLocaleString("pt-BR")}</div></div>
          <div className="rounded-lg border border-red-200 bg-red-50 p-3"><div className="text-xs text-red-700">Inválidos</div><div className="text-lg font-semibold text-red-700">{preview.invalidCount.toLocaleString("pt-BR")}</div></div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2 text-sm text-muted">
          <span>Fluxo: <strong className="text-ink">{preview.flow.name}</strong></span>
          <span>·</span>
          <span>Template: <strong className="text-ink">{preview.flow.templateName}</strong></span>
          <span>·</span>
          <span>Categoria Meta: <strong className="text-ink">{preview.flow.templateCategory}</strong></span>
        </div>

        <div className="mt-4 space-y-3">
          {preview.previewContacts.length ? preview.previewContacts.map((contact, index) => <div key={index} className="rounded-lg border border-line bg-wash p-4">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted">{contact.name || "Contato " + (index + 1)}</div>
            <div className="mt-2 whitespace-pre-wrap text-sm text-ink">{contact.text}</div>
          </div>) : <EmptyState title="Sem contatos válidos" description="Nenhum telefone válido encontrado com o mapeamento atual." />}
        </div>

        <div className="mt-6 rounded-lg border border-line bg-wash p-4">
          <label className="block text-sm font-medium text-ink">Nome do disparo
            <input value={broadcastName} onChange={(event) => setBroadcastName(event.target.value)} placeholder="Convite Achadinhos — agosto" className="mt-1 h-11 w-full max-w-md rounded-lg border border-line px-3" />
          </label>
          <p className="mt-3 text-sm text-muted">Cada novo disparo envia para todos os contatos válidos da lista, mesmo que eles já tenham recebido este fluxo em outro disparo.</p>
          <label className="mt-4 block text-sm font-medium text-ink">Ritmo de envio
            <select value={deliverySpeed} onChange={(event) => setDeliverySpeed(event.target.value as "standard" | "urgent")} className="mt-1 h-11 w-full max-w-md rounded-lg border border-line bg-white px-3 text-sm">
              <option value="standard">Padrão — 5 contatos em paralelo</option>
              <option value="urgent">Urgente/Ao Vivo — até 60 contatos em paralelo</option>
            </select>
          </label>
          {deliverySpeed === "urgent" ? <p className="mt-2 text-sm text-amber-700">Para avisos urgentes. O ritmo é limitado pelo throughput informado pela Meta; se ela limitar o envio, o disparo pausa automaticamente para proteger a conta.</p> : null}

          <label className="mt-4 flex items-center gap-2 text-sm font-medium text-ink"><Calendar size={16} /> Quando disparar</label>
          <div className="mt-2 flex max-w-md gap-2">
            <button type="button" onClick={() => setSendMode("agora")} className={`h-10 flex-1 rounded-lg border text-sm font-medium ${sendMode === "agora" ? "border-ink bg-ink text-white" : "border-line bg-white text-ink"}`}>Enviar agora</button>
            <button type="button" onClick={() => setSendMode("agendar")} className={`h-10 flex-1 rounded-lg border text-sm font-medium ${sendMode === "agendar" ? "border-ink bg-ink text-white" : "border-line bg-white text-ink"}`}>Agendar envio</button>
          </div>
          {sendMode === "agendar" ? <div className="mt-2 max-w-md">
            <div className="grid grid-cols-2 gap-2">
              <input type="date" value={scheduleDate} onChange={(event) => setScheduleDate(event.target.value)} className="h-11 rounded-lg border border-line bg-white px-3 text-sm" />
              <input type="time" value={scheduleTime} onChange={(event) => setScheduleTime(event.target.value)} className="h-11 rounded-lg border border-line bg-white px-3 text-sm" />
            </div>
            <div className="mt-2 text-xs text-muted">Horário de Brasília (GMT-3).{scheduledAtIso ? ` Disparo programado para ${formatBrasilia(scheduledAtIso)}.` : ""}</div>
          </div> : null}

          {startError ? <div className="mt-3"><ErrorState message={startError} /></div> : null}
          <ActionButton icon={<Send size={16} />} disabled={!broadcastName.trim() || !preview.validCount} onClick={() => setConfirming(true)} className="mt-4">{sendMode === "agendar" ? "Agendar disparo" : "Iniciar disparo"}</ActionButton>
        </div>
      </section> : null}
    </div>

    <ConfirmModal
      open={confirming}
      title={sendMode === "agendar" ? "Agendar disparo?" : "Iniciar disparo?"}
      onCancel={() => setConfirming(false)}
      onConfirm={startBroadcast}
      confirmLabel={starting ? (sendMode === "agendar" ? "Agendando…" : "Iniciando…") : (sendMode === "agendar" ? "Confirmar agendamento" : "Confirmar disparo")}
      loading={starting}
    >
      {sendMode === "agendar" && scheduledAtIso
        ? <>Você está prestes a agendar o fluxo &quot;{preview?.flow.name}&quot; para {preview?.validCount.toLocaleString("pt-BR")} contatos, com envio em {formatBrasilia(scheduledAtIso)} (horário de Brasília), no ritmo {deliverySpeed === "urgent" ? "Urgente/Ao Vivo (até 60 em paralelo)" : "Padrão (5 em paralelo)"}. Essa ação enviará mensagens reais via WhatsApp na hora marcada.</>
        : <>Você está prestes a iniciar o fluxo &quot;{preview?.flow.name}&quot; para {preview?.validCount.toLocaleString("pt-BR")} contatos no ritmo {deliverySpeed === "urgent" ? "Urgente/Ao Vivo (até 60 em paralelo)" : "Padrão (5 em paralelo)"}. Essa ação envia mensagens reais via WhatsApp.</>}
    </ConfirmModal>
  </AppShell>;
}
