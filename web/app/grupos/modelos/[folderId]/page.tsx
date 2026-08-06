"use client";

import { ActionButton, AppShell, ConfirmModal, FileDropzone, LoadingState, MediaPreview, SearchInput, Toast } from "@/components/ui";
import { type ParsedImportModel, parseDOCX } from "@/lib/docx-import";
import { CheckCircle2, ChevronRight, Download, FileText, Loader2, Pencil, Plus, Trash2, TriangleAlert, X, XCircle } from "lucide-react";
import Link from "next/link";
import { use, useCallback, useEffect, useMemo, useRef, useState } from "react";

type MessageKind = "texto" | "imagem" | "video" | "audio" | "documento";

type Pasta = { id: string; nome: string; updated_at?: string | null };

type Modelo = {
  id: string;
  pasta_id?: string | null;
  nome: string;
  tipo: MessageKind;
  texto?: string | null;
  media_bucket?: string | null;
  media_path?: string | null;
  file_name?: string | null;
  mime_type?: string | null;
  file_size_bytes?: number | null;
  updated_at?: string | null;
};

type ImportStep = "idle" | "parsing" | "preview" | "importing" | "done";
type ImportResult = { nome: string; ok: boolean; error?: string };

const tipoLabels: Record<MessageKind, string> = {
  texto: "Mensagem de texto",
  imagem: "Imagem com texto",
  video: "Vídeo com texto",
  audio: "Áudio",
  documento: "Documento",
};

function formatModelDate(dateStr?: string | null): string {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  const now = new Date();
  const days = Math.floor((now.getTime() - d.getTime()) / 86400000);
  if (days === 0) return "Atualizado hoje";
  if (days === 1) return "Atualizado ontem";
  if (days < 7) return `Atualizado há ${days} dias`;
  return `Atualizado em ${d.toLocaleDateString("pt-BR")}`;
}

export default function PastaPage({ params }: { params: Promise<{ folderId: string }> }) {
  const { folderId } = use(params);
  const [pasta, setPasta] = useState<Pasta | null>(null);
  const [modelos, setModelos] = useState<Modelo[]>([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState("");
  const [query, setQuery] = useState("");
  const [showModelModal, setShowModelModal] = useState(false);
  const [editingModel, setEditingModel] = useState<Modelo | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Modelo | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const nameInputRef = useRef<HTMLInputElement>(null);

  // Form state
  const [modelName, setModelName] = useState("");
  const [modelKind, setModelKind] = useState<MessageKind>("texto");
  const [modelText, setModelText] = useState("");
  const [modelFile, setModelFile] = useState<File | null>(null);

  // ── Import state ────────────────────────────────────────────────────────────
  const [importOpen, setImportOpen] = useState(false);
  const [importStep, setImportStep] = useState<ImportStep>("idle");
  const [importDocxFile, setImportDocxFile] = useState<File | null>(null);
  const [parsedModels, setParsedModels] = useState<ParsedImportModel[]>([]);
  const [importProgress, setImportProgress] = useState({ current: 0, total: 0, label: "" });
  const [importResults, setImportResults] = useState<ImportResult[]>([]);
  const importFileInputRef = useRef<HTMLInputElement>(null);

  const filteredModelos = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return modelos;
    return modelos.filter(
      (m) =>
        m.nome.toLowerCase().includes(q) ||
        (m.texto || "").toLowerCase().includes(q)
    );
  }, [modelos, query]);

  const load = useCallback(async () => {
    const [pr, mr] = await Promise.all([
      fetch("/api/modelos/pastas"),
      fetch(`/api/modelos?pasta_id=${folderId}`),
    ]);
    const [pastas, models] = await Promise.all([pr.json(), mr.json()]);
    if (!pr.ok) throw new Error(pastas.error || "Falha ao carregar.");
    if (!mr.ok) throw new Error(models.error || "Falha ao carregar modelos.");
    const found = Array.isArray(pastas)
      ? (pastas as Pasta[]).find((p) => p.id === folderId) ?? null
      : null;
    setPasta(found);
    setModelos(Array.isArray(models) ? models : []);
  }, [folderId]);

  useEffect(() => {
    load().catch((e: any) => setToast(e.message)).finally(() => setLoading(false));
  }, [load]);

  function showMsg(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(""), 3500);
  }

  function openCreate() {
    setEditingModel(null);
    setModelName("");
    setModelKind("texto");
    setModelText("");
    setModelFile(null);
    setShowModelModal(true);
    setTimeout(() => nameInputRef.current?.focus(), 60);
  }

  function openEdit(modelo: Modelo) {
    setEditingModel(modelo);
    setModelName(modelo.nome);
    setModelKind(modelo.tipo);
    setModelText(modelo.texto || "");
    setModelFile(null);
    setShowModelModal(true);
    setTimeout(() => nameInputRef.current?.focus(), 60);
  }

  function closeModal() {
    if (saving) return;
    setShowModelModal(false);
    setEditingModel(null);
    setModelName("");
    setModelKind("texto");
    setModelText("");
    setModelFile(null);
  }

  // ── Shared upload helper (reused by manual save AND import) ─────────────────
  async function uploadMedia(file: File, kind: MessageKind) {
    const res = await fetch("/api/upload/signed-url", {
      method: "POST",
      body: JSON.stringify({
        tipo: kind,
        file_name: file.name,
        mime_type: file.type,
        file_size_bytes: file.size,
      }),
    });
    const signed = await res.json();
    if (!res.ok) throw new Error(signed.error || "Falha ao preparar arquivo.");
    await fetch(signed.signedUrl, {
      method: "PUT",
      headers: { "content-type": file.type },
      body: file,
    });
    await fetch("/api/upload/confirm", {
      method: "POST",
      body: JSON.stringify({ storage_path: signed.storage_path }),
    });
    return {
      bucket: signed.bucket,
      storage_path: signed.storage_path,
      file_name: file.name,
      mime_type: file.type,
      file_size_bytes: file.size,
    };
  }

  async function handleSaveModel() {
    if (!modelName.trim()) return;
    const prev = editingModel;
    if (modelKind !== "texto" && !modelFile && !prev?.media_bucket) {
      showMsg("Selecione um arquivo para este tipo de modelo.");
      return;
    }
    setSaving(true);
    try {
      const media = modelFile
        ? await uploadMedia(modelFile, modelKind)
        : prev?.media_bucket && prev.media_path && modelKind !== "texto"
          ? {
              bucket: prev.media_bucket,
              storage_path: prev.media_path,
              file_name: prev.file_name || "arquivo",
              mime_type: prev.mime_type || "application/octet-stream",
              file_size_bytes: Number(prev.file_size_bytes || 1),
            }
          : null;

      const body = {
        id: editingModel?.id,
        pasta_id: folderId,
        nome: modelName.trim(),
        tipo: modelKind,
        texto: modelText || null,
        media,
      };
      const res = await fetch("/api/modelos", {
        method: editingModel ? "PATCH" : "POST",
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Falha ao salvar modelo.");
      showMsg(editingModel ? "Modelo atualizado." : "Modelo criado.");
      closeModal();
      await load();
    } catch (e: any) {
      showMsg(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteModel() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await fetch("/api/modelos", {
        method: "DELETE",
        body: JSON.stringify({ id: deleteTarget.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Falha ao apagar modelo.");
      showMsg("Modelo apagado.");
      setDeleteTarget(null);
      await load();
    } catch (e: any) {
      showMsg(e.message);
    } finally {
      setDeleting(false);
    }
  }

  // ── Import handlers ─────────────────────────────────────────────────────────
  function openImport() {
    setImportOpen(true);
    setImportStep("idle");
    setImportDocxFile(null);
    setParsedModels([]);
    setImportResults([]);
    setImportProgress({ current: 0, total: 0, label: "" });
  }

  function closeImport() {
    if (importStep === "importing") return;
    setImportOpen(false);
    setImportStep("idle");
    setImportDocxFile(null);
  }

  async function handleProcessDocx() {
    if (!importDocxFile) return;
    setImportStep("parsing");
    try {
      const models = await parseDOCX(importDocxFile);
      setParsedModels(models);
      setImportStep("preview");
    } catch (e: any) {
      showMsg(e.message);
      setImportStep("idle");
    }
  }

  async function handleImportAll() {
    if (!parsedModels.length) return;
    setImportStep("importing");
    const results: ImportResult[] = [];

    for (let i = 0; i < parsedModels.length; i++) {
      const m = parsedModels[i];
      setImportProgress({ current: i + 1, total: parsedModels.length, label: m.nome });
      try {
        let media = null;
        if (m.imageFile) {
          media = await uploadMedia(m.imageFile, "imagem");
        }
        const res = await fetch("/api/modelos", {
          method: "POST",
          body: JSON.stringify({
            pasta_id: folderId,
            nome: m.nome,
            tipo: m.imageFile ? "imagem" : "texto",
            texto: m.texto || null,
            media,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Falha ao criar modelo.");
        results.push({ nome: m.nome, ok: true });
      } catch (e: any) {
        results.push({ nome: m.nome, ok: false, error: e.message });
      }
    }

    setImportResults(results);
    setImportStep("done");
    await load(); // refresh models list immediately — no page reload needed
  }

  const modelCount = modelos.length;
  const hasQuery = query.trim().length > 0;

  // Preview stats
  const previewWarningCount = parsedModels.filter((m) => m.warnings.length > 0).length;
  const importSuccessCount = importResults.filter((r) => r.ok).length;
  const importFailCount = importResults.filter((r) => !r.ok).length;

  return (
    <AppShell
      title={pasta?.nome || "Pasta"}
      subtitle={`${modelCount} ${modelCount === 1 ? "modelo salvo" : "modelos salvos"}`}
      action={
        <>
          <ActionButton
            icon={<Download size={16} />}
            onClick={openImport}
            className="border border-line bg-white text-ink hover:bg-wash"
          >
            Importar modelos
          </ActionButton>
          <ActionButton
            icon={<Plus size={16} />}
            onClick={openCreate}
            className="bg-black text-white hover:bg-zinc-800"
          >
            Novo modelo
          </ActionButton>
        </>
      }
    >
      {/* Breadcrumb */}
      <nav aria-label="Navegação" className="mb-5 flex items-center gap-1.5 text-sm text-muted">
        <Link href="/grupos/modelos" className="hover:text-ink transition-colors">
          Modelos
        </Link>
        <ChevronRight size={14} />
        <span className="text-ink">{pasta?.nome || "..."}</span>
      </nav>

      {/* Search */}
      <div className="mb-6">
        <SearchInput
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Pesquisar modelos nesta pasta..."
        />
      </div>

      {loading ? (
        <LoadingState />
      ) : modelCount === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-full border border-line bg-panel mb-4">
            <FileText size={28} className="text-muted" />
          </div>
          <h2 className="text-lg font-semibold text-ink">Esta pasta ainda está vazia</h2>
          <p className="mt-2 max-w-xs text-sm text-muted">
            Crie seu primeiro modelo de mensagem para começar.
          </p>
          <ActionButton
            icon={<Plus size={16} />}
            onClick={openCreate}
            className="mt-6 bg-black text-white hover:bg-zinc-800"
          >
            Criar primeiro modelo
          </ActionButton>
        </div>
      ) : filteredModelos.length === 0 && hasQuery ? (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <h2 className="text-lg font-semibold text-ink">Nenhum modelo encontrado</h2>
          <p className="mt-2 text-sm text-muted">
            Tente pesquisar usando outro nome ou conteúdo.
          </p>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filteredModelos.map((modelo) => (
            <article
              key={modelo.id}
              className="flex flex-col justify-between rounded-lg border border-line bg-panel p-5 shadow-soft"
            >
              <div className="min-w-0">
                <h3 className="font-semibold text-ink">{modelo.nome}</h3>
                {modelo.texto ? (
                  <p className="mt-2 line-clamp-3 whitespace-pre-wrap text-sm text-muted">
                    {modelo.texto}
                  </p>
                ) : (
                  <p className="mt-2 text-sm text-muted italic">
                    {modelo.file_name || "Arquivo anexado"}
                  </p>
                )}
                <p className="mt-3 text-xs text-muted">
                  {tipoLabels[modelo.tipo]}
                  {modelo.updated_at ? ` · ${formatModelDate(modelo.updated_at)}` : ""}
                </p>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => openEdit(modelo)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-sm transition hover:bg-wash"
                >
                  <Pencil size={14} /> Editar
                </button>
                <button
                  type="button"
                  onClick={() => setDeleteTarget(modelo)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 px-3 py-1.5 text-sm text-red-600 transition hover:bg-red-50"
                >
                  <Trash2 size={14} /> Apagar
                </button>
              </div>
            </article>
          ))}
        </div>
      )}

      {/* ── Create / Edit model modal ─────────────────────────────────────────── */}
      {showModelModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
          onClick={closeModal}
        >
          <div
            role="dialog"
            aria-modal="true"
            className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-xl bg-white shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-line px-6 py-5">
              <h2 className="text-lg font-semibold text-ink">
                {editingModel ? "Editar modelo" : "Novo modelo"}
              </h2>
              <button
                type="button"
                onClick={closeModal}
                aria-label="Fechar"
                className="rounded-lg p-1.5 text-muted hover:bg-wash hover:text-ink"
              >
                <X size={18} />
              </button>
            </div>

            <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
              <div>
                <label className="text-sm font-medium text-ink">Nome do modelo</label>
                <input
                  ref={nameInputRef}
                  value={modelName}
                  onChange={(e) => setModelName(e.target.value)}
                  placeholder="Ex.: Oferta do dia"
                  className="focus-ring mt-1 h-11 w-full rounded-lg border border-line px-3 text-sm"
                />
              </div>

              <div>
                <label className="text-sm font-medium text-ink">Tipo da mensagem</label>
                <select
                  value={modelKind}
                  onChange={(e) => setModelKind(e.target.value as MessageKind)}
                  className="focus-ring mt-1 h-11 w-full rounded-lg border border-line px-3 text-sm"
                >
                  {Object.entries(tipoLabels).map(([v, l]) => (
                    <option key={v} value={v}>{l}</option>
                  ))}
                </select>
              </div>

              {(["texto", "imagem", "video"] as MessageKind[]).includes(modelKind) && (
                <div>
                  <label className="text-sm font-medium text-ink">Mensagem</label>
                  <textarea
                    value={modelText}
                    onChange={(e) => setModelText(e.target.value)}
                    rows={6}
                    placeholder="Digite sua mensagem aqui..."
                    className="focus-ring mt-1 w-full resize-none rounded-lg border border-line p-3 text-sm"
                  />
                </div>
              )}

              {modelKind !== "texto" && (
                <div>
                  <label className="text-sm font-medium text-ink">Arquivo</label>
                  {editingModel?.file_name && !modelFile && (
                    <p className="mb-2 mt-1 text-xs text-muted">
                      Arquivo atual: <span className="font-medium">{editingModel.file_name}</span>
                    </p>
                  )}
                  <div className="mt-1">
                    <FileDropzone onFile={setModelFile} />
                  </div>
                  {modelFile && (
                    <MediaPreview fileName={modelFile.name} mimeType={modelFile.type} />
                  )}
                </div>
              )}
            </div>

            <div className="flex justify-end gap-3 border-t border-line px-6 py-4">
              <ActionButton
                disabled={saving}
                onClick={closeModal}
                className="border border-line bg-white text-ink hover:bg-wash"
              >
                Cancelar
              </ActionButton>
              <ActionButton
                disabled={!modelName.trim() || saving}
                icon={saving ? <Loader2 size={16} className="animate-spin" /> : undefined}
                onClick={handleSaveModel}
                className="bg-black text-white hover:bg-zinc-800"
              >
                {editingModel ? "Salvar alterações" : "Salvar modelo"}
              </ActionButton>
            </div>
          </div>
        </div>
      )}

      {/* ── Import modal ──────────────────────────────────────────────────────── */}
      {importOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
          onClick={() => importStep !== "importing" && closeImport()}
        >
          <div
            role="dialog"
            aria-modal="true"
            className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-xl bg-white shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal header */}
            <div className="flex items-center justify-between border-b border-line px-6 py-5">
              <div>
                <h2 className="text-lg font-semibold text-ink">
                  {importStep === "idle" && "Importar modelos"}
                  {importStep === "parsing" && "Processando documento..."}
                  {importStep === "preview" && `Revisão · ${parsedModels.length} ${parsedModels.length === 1 ? "modelo encontrado" : "modelos encontrados"}`}
                  {importStep === "importing" && "Importando modelos..."}
                  {importStep === "done" && "Importação concluída"}
                </h2>
                {importStep === "idle" && (
                  <p className="mt-0.5 text-sm text-muted">
                    Pasta atual: <span className="font-medium text-ink">{pasta?.nome}</span>
                  </p>
                )}
              </div>
              {importStep !== "importing" && (
                <button
                  type="button"
                  onClick={closeImport}
                  aria-label="Fechar"
                  className="rounded-lg p-1.5 text-muted hover:bg-wash hover:text-ink"
                >
                  <X size={18} />
                </button>
              )}
            </div>

            {/* Modal body */}
            <div className="flex-1 overflow-y-auto px-6 py-5">

              {/* Step: idle — file selector */}
              {importStep === "idle" && (
                <div className="space-y-4">
                  <p className="text-sm text-muted">
                    Selecione um arquivo <span className="font-medium text-ink">.docx</span> com os modelos organizados pelo marcador <span className="font-mono font-medium text-ink">NOME:</span>.
                  </p>
                  <label className="flex cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-line bg-wash p-8 text-center transition hover:border-zinc-300 hover:bg-white">
                    <Download size={28} className="text-muted" />
                    <div>
                      <p className="text-sm font-medium text-ink">
                        {importDocxFile ? importDocxFile.name : "Selecionar arquivo .docx"}
                      </p>
                      <p className="mt-1 text-xs text-muted">
                        {importDocxFile
                          ? `${(importDocxFile.size / 1024).toFixed(1)} KB · clique para trocar`
                          : "Clique para selecionar ou arraste aqui"}
                      </p>
                    </div>
                    <input
                      ref={importFileInputRef}
                      type="file"
                      accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                      className="sr-only"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (!f) return;
                        if (!f.name.toLowerCase().endsWith(".docx")) {
                          showMsg("Selecione um arquivo .docx válido.");
                          return;
                        }
                        setImportDocxFile(f);
                      }}
                    />
                  </label>
                  <div className="rounded-lg border border-line bg-wash p-4 text-xs text-muted space-y-1">
                    <p className="font-medium text-ink">Formato esperado do documento:</p>
                    <p>Cada modelo começa com <span className="font-mono">NOME: Nome do modelo</span></p>
                    <p>Seguido pela mensagem e por uma imagem incorporada no documento.</p>
                  </div>
                </div>
              )}

              {/* Step: parsing — spinner */}
              {importStep === "parsing" && (
                <div className="flex flex-col items-center justify-center py-10 gap-4">
                  <Loader2 size={36} className="animate-spin text-muted" />
                  <div className="text-center">
                    <p className="font-medium text-ink">Lendo modelos...</p>
                    <p className="mt-1 text-sm text-muted">Extraindo texto e imagens do documento.</p>
                  </div>
                </div>
              )}

              {/* Step: preview — review list */}
              {importStep === "preview" && (
                <div className="space-y-3">
                  {previewWarningCount > 0 && (
                    <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                      <TriangleAlert size={15} className="mt-0.5 shrink-0" />
                      <span>{previewWarningCount} {previewWarningCount === 1 ? "modelo possui avisos" : "modelos possuem avisos"} — eles ainda serão importados.</span>
                    </div>
                  )}
                  <div className="divide-y divide-line overflow-hidden rounded-xl border border-line">
                    {parsedModels.map((m, i) => (
                      <div key={i} className="px-4 py-3">
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-sm font-medium text-ink truncate">{m.nome || <span className="italic text-muted">Sem nome</span>}</p>
                          {m.warnings.length === 0
                            ? <CheckCircle2 size={15} className="shrink-0 text-emerald-500 mt-0.5" />
                            : <TriangleAlert size={15} className="shrink-0 text-amber-500 mt-0.5" />}
                        </div>
                        <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1">
                          <span className={`flex items-center gap-1 text-xs ${m.texto ? "text-emerald-600" : "text-red-500"}`}>
                            {m.texto ? <CheckCircle2 size={11} /> : <XCircle size={11} />}
                            Mensagem
                          </span>
                          <span className={`flex items-center gap-1 text-xs ${m.imageFile ? "text-emerald-600" : "text-amber-600"}`}>
                            {m.imageFile ? <CheckCircle2 size={11} /> : <TriangleAlert size={11} />}
                            Imagem
                          </span>
                        </div>
                        {m.warnings.length > 0 && (
                          <ul className="mt-2 space-y-0.5">
                            {m.warnings.map((w, wi) => (
                              <li key={wi} className="text-xs text-amber-700">⚠ {w}</li>
                            ))}
                          </ul>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Step: importing — progress */}
              {importStep === "importing" && (
                <div className="space-y-4 py-4">
                  <div className="text-center">
                    <p className="text-sm font-medium text-ink">
                      Criando modelo {importProgress.current} de {importProgress.total}
                    </p>
                    <p className="mt-1 text-xs text-muted truncate">{importProgress.label}</p>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-wash">
                    <div
                      className="h-full rounded-full bg-black transition-all duration-300"
                      style={{ width: `${importProgress.total > 0 ? (importProgress.current / importProgress.total) * 100 : 0}%` }}
                    />
                  </div>
                  <p className="text-center text-xs text-muted">
                    Não feche esta janela até a importação terminar.
                  </p>
                </div>
              )}

              {/* Step: done — results */}
              {importStep === "done" && (
                <div className="space-y-4">
                  <div className={`flex items-center gap-3 rounded-xl p-4 ${importFailCount === 0 ? "border border-emerald-200 bg-emerald-50" : "border border-amber-200 bg-amber-50"}`}>
                    {importFailCount === 0
                      ? <CheckCircle2 size={20} className="shrink-0 text-emerald-600" />
                      : <TriangleAlert size={20} className="shrink-0 text-amber-600" />}
                    <div>
                      <p className="text-sm font-semibold text-ink">
                        {importSuccessCount} {importSuccessCount === 1 ? "modelo importado" : "modelos importados"} com sucesso.
                      </p>
                      {importFailCount > 0 && (
                        <p className="text-sm text-amber-800">
                          {importFailCount} {importFailCount === 1 ? "modelo com erro" : "modelos com erro"}.
                        </p>
                      )}
                    </div>
                  </div>
                  {importFailCount > 0 && (
                    <div className="divide-y divide-line overflow-hidden rounded-xl border border-line">
                      {importResults.filter((r) => !r.ok).map((r, i) => (
                        <div key={i} className="flex items-start gap-2 px-4 py-3">
                          <XCircle size={14} className="mt-0.5 shrink-0 text-red-500" />
                          <div>
                            <p className="text-sm font-medium text-ink">{r.nome}</p>
                            <p className="text-xs text-red-600">{r.error}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Modal footer */}
            <div className="flex justify-end gap-3 border-t border-line px-6 py-4">
              {importStep === "idle" && (
                <>
                  <ActionButton onClick={closeImport} className="border border-line bg-white text-ink hover:bg-wash">
                    Cancelar
                  </ActionButton>
                  <ActionButton
                    disabled={!importDocxFile}
                    icon={<Download size={15} />}
                    onClick={handleProcessDocx}
                    className="bg-black text-white hover:bg-zinc-800"
                  >
                    Processar arquivo
                  </ActionButton>
                </>
              )}

              {importStep === "preview" && (
                <>
                  <ActionButton onClick={closeImport} className="border border-line bg-white text-ink hover:bg-wash">
                    Cancelar
                  </ActionButton>
                  <ActionButton
                    disabled={parsedModels.length === 0}
                    onClick={handleImportAll}
                    className="bg-black text-white hover:bg-zinc-800"
                  >
                    Importar {parsedModels.length} {parsedModels.length === 1 ? "modelo" : "modelos"}
                  </ActionButton>
                </>
              )}

              {importStep === "done" && (
                <ActionButton onClick={closeImport} className="bg-black text-white hover:bg-zinc-800">
                  Fechar
                </ActionButton>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Delete confirm */}
      <ConfirmModal
        open={Boolean(deleteTarget)}
        title="Apagar modelo?"
        confirmLabel="Apagar modelo"
        onCancel={() => setDeleteTarget(null)}
        onConfirm={handleDeleteModel}
        loading={deleting}
        destructive
      >
        {`Tem certeza de que deseja apagar o modelo "${deleteTarget?.nome}"? Essa ação não poderá ser desfeita.`}
      </ConfirmModal>

      <Toast message={toast} />
    </AppShell>
  );
}
