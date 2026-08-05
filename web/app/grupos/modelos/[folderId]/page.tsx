"use client";

import { ActionButton, AppShell, ConfirmModal, FileDropzone, LoadingState, MediaPreview, SearchInput, Toast } from "@/components/ui";
import { ChevronRight, FileText, Loader2, Pencil, Plus, Trash2, X } from "lucide-react";
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

  const modelCount = modelos.length;
  const hasQuery = query.trim().length > 0;

  return (
    <AppShell
      title={pasta?.nome || "Pasta"}
      subtitle={`${modelCount} ${modelCount === 1 ? "modelo salvo" : "modelos salvos"}`}
      action={
        <ActionButton
          icon={<Plus size={16} />}
          onClick={openCreate}
          className="bg-black text-white hover:bg-zinc-800"
        >
          Novo modelo
        </ActionButton>
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
        /* Empty folder */
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
        /* No results from search */
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <h2 className="text-lg font-semibold text-ink">Nenhum modelo encontrado</h2>
          <p className="mt-2 text-sm text-muted">
            Tente pesquisar usando outro nome ou conteúdo.
          </p>
        </div>
      ) : (
        /* Models grid */
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

      {/* Create / Edit model modal */}
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
            {/* Modal header */}
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

            {/* Modal body */}
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

            {/* Modal footer */}
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
