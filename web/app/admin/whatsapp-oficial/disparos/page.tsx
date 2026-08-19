"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ActionButton, AppShell, ConfirmModal, DataTable, EmptyState, ErrorState, FileDropzone } from "@/components/ui";
import { ArrowLeft, FileSpreadsheet, Send } from "lucide-react";

type FieldMapping = { mode: "column" | "fixed" | "none"; column: string; fixedValue: string };
type Flow = { id: string; name: string; initial_template_name: string; initial_template_language: string; active: boolean; official_quick_reply_actions: { button_label: string | null; payload: string } };
type PreviewResult = {
  totalRows: number; validCount: number; duplicateCount: number; invalidCount: number;
  previewContacts: Array<{ name: string | null; text: string }>;
  flow: { name: string; templateName: string; templateCategory: string; buttonLabel: string | null };
};

type BroadcastSummary = { id: string; name: string; status: string; total_rows: number; accepted: number; failed: number; processed: number; created_at: string; official_flows: { name: string } | null };

const emptyMapping: FieldMapping = { mode: "none", column: "", fixedValue: "" };
const STATUS_LABELS: Record<string, string> = { draft: "Rascunho", ready: "Pronto", processing: "Em andamento", paused: "Pausado", completed: "Concluído", failed: "Falhou" };

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

  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState("");

  const [broadcastName, setBroadcastName] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState("");

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
        body: JSON.stringify({ flowId: selectedFlowId, contacts })
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
        body: JSON.stringify({ name: broadcastName.trim(), flowId: selectedFlowId, contacts })
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

  return <AppShell title="Disparo 1x1" subtitle="Lista CSV/XLSX → escolher fluxo → mapear colunas → preview → confirmar e enviar">
    <div className="space-y-6">
      <Link href="/admin/whatsapp-oficial/fluxos" className="inline-flex items-center gap-2 text-sm text-muted hover:text-ink"><ArrowLeft size={15} /> Fluxos</Link>

      {broadcasts.length ? <section>
        <h2 className="mb-3 text-lg font-semibold text-ink">Histórico</h2>
        <DataTable
          columns={["Data", "Nome", "Fluxo", "Contatos", "Aceitos", "Falharam", "Status"]}
          rows={broadcasts.map((broadcast) => [
            new Date(broadcast.created_at).toLocaleString("pt-BR"),
            <Link key="name" href={`/admin/whatsapp-oficial/disparos/${broadcast.id}`} className="font-medium text-ink hover:underline">{broadcast.name}</Link>,
            broadcast.official_flows?.name || "—",
            broadcast.total_rows,
            broadcast.accepted,
            broadcast.failed,
            <span key="status" className={`rounded-full border px-2.5 py-1 text-xs font-medium ${broadcast.status === "failed" ? "border-red-200 bg-red-50 text-red-700" : broadcast.status === "completed" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-line bg-wash text-muted"}`}>{STATUS_LABELS[broadcast.status] || broadcast.status}</span>
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
          {startError ? <div className="mt-3"><ErrorState message={startError} /></div> : null}
          <ActionButton icon={<Send size={16} />} disabled={!broadcastName.trim() || !preview.validCount} onClick={() => setConfirming(true)} className="mt-4">Iniciar disparo</ActionButton>
        </div>
      </section> : null}
    </div>

    <ConfirmModal
      open={confirming}
      title="Iniciar disparo?"
      onCancel={() => setConfirming(false)}
      onConfirm={startBroadcast}
      confirmLabel={starting ? "Iniciando…" : "Confirmar disparo"}
      loading={starting}
    >
      Você está prestes a iniciar o fluxo &quot;{preview?.flow.name}&quot; para {preview?.validCount.toLocaleString("pt-BR")} contatos. Essa ação envia mensagens reais via WhatsApp.
    </ConfirmModal>
  </AppShell>;
}
