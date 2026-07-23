"use client";

import { ActionButton, AppShell, ConfirmModal, EmptyState, FileDropzone, LoadingState, MediaPreview, SearchInput, Toast } from "@/components/ui";
import { FilePenLine, FolderPlus, Plus, Save, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

type MessageKind = "texto" | "imagem" | "video" | "audio" | "documento";
type Pasta = { id: string; nome: string };
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
};

const labels: Record<MessageKind, string> = {
  texto: "Apenas texto",
  imagem: "Texto + imagem",
  video: "Texto + vídeo",
  audio: "Áudio",
  documento: "Documento"
};

export default function ModelosPage() {
  const [pastas, setPastas] = useState<Pasta[]>([]);
  const [modelos, setModelos] = useState<Modelo[]>([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState("");
  const [query, setQuery] = useState("");
  const [folderFilter, setFolderFilter] = useState("all");
  const [folderName, setFolderName] = useState("");
  const [editingFolder, setEditingFolder] = useState<Pasta | null>(null);
  const [modelId, setModelId] = useState("");
  const [modelName, setModelName] = useState("");
  const [modelFolderId, setModelFolderId] = useState("");
  const [modelKind, setModelKind] = useState<MessageKind>("texto");
  const [modelText, setModelText] = useState("");
  const [modelFile, setModelFile] = useState<File | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ type: "pasta" | "modelo"; id: string; name: string } | null>(null);
  const [deleting, setDeleting] = useState(false);

  async function load() {
    const [foldersResponse, modelsResponse] = await Promise.all([fetch("/api/modelos/pastas"), fetch("/api/modelos")]);
    const [folders, models] = await Promise.all([foldersResponse.json(), modelsResponse.json()]);
    if (!foldersResponse.ok || !modelsResponse.ok) throw new Error(folders.error || models.error || "Falha ao carregar modelos.");
    setPastas(Array.isArray(folders) ? folders : []);
    setModelos(Array.isArray(models) ? models : []);
  }

  useEffect(() => {
    load().catch((error) => setToast(error.message)).finally(() => setLoading(false));
  }, []);

  const filteredModels = useMemo(() => modelos.filter((modelo) => {
    const matchesFolder = folderFilter === "all" || (folderFilter === "none" ? !modelo.pasta_id : modelo.pasta_id === folderFilter);
    return matchesFolder && modelo.nome.toLowerCase().includes(query.trim().toLowerCase());
  }), [modelos, folderFilter, query]);

  function resetModel() {
    setModelId("");
    setModelName("");
    setModelFolderId("");
    setModelKind("texto");
    setModelText("");
    setModelFile(null);
  }

  function editModel(modelo: Modelo) {
    setModelId(modelo.id);
    setModelName(modelo.nome);
    setModelFolderId(modelo.pasta_id || "");
    setModelKind(modelo.tipo);
    setModelText(modelo.texto || "");
    setModelFile(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function uploadMedia(file: File, kind: MessageKind) {
    const response = await fetch("/api/upload/signed-url", {
      method: "POST",
      body: JSON.stringify({ tipo: kind, file_name: file.name, mime_type: file.type, file_size_bytes: file.size })
    });
    const signed = await response.json();
    if (!response.ok) throw new Error(signed.error || "Falha ao preparar arquivo.");
    await fetch(signed.signedUrl, { method: "PUT", headers: { "content-type": file.type }, body: file });
    await fetch("/api/upload/confirm", { method: "POST", body: JSON.stringify({ storage_path: signed.storage_path }) });
    return { bucket: signed.bucket, storage_path: signed.storage_path, file_name: file.name, mime_type: file.type, file_size_bytes: file.size };
  }

  async function saveFolder() {
    const name = editingFolder ? editingFolder.nome : folderName;
    const response = await fetch("/api/modelos/pastas", {
      method: editingFolder ? "PATCH" : "POST",
      body: JSON.stringify({ id: editingFolder?.id, nome: name })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Falha ao salvar pasta.");
    setEditingFolder(null);
    setFolderName("");
    setToast(editingFolder ? "Pasta renomeada." : "Pasta criada.");
    await load();
  }

  async function saveModel() {
    const previous = modelos.find((modelo) => modelo.id === modelId);
    if (modelKind !== "texto" && !modelFile && !previous?.media_bucket) throw new Error("Selecione um arquivo para este modelo.");
    const media = modelFile ? await uploadMedia(modelFile, modelKind) : previous?.media_bucket && previous.media_path && modelKind !== "texto" ? {
      bucket: previous.media_bucket,
      storage_path: previous.media_path,
      file_name: previous.file_name || "arquivo",
      mime_type: previous.mime_type || "application/octet-stream",
      file_size_bytes: Number(previous.file_size_bytes || 1)
    } : null;
    const response = await fetch("/api/modelos", {
      method: modelId ? "PATCH" : "POST",
      body: JSON.stringify({ id: modelId || undefined, pasta_id: modelFolderId || null, nome: modelName, tipo: modelKind, texto: modelText, media })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Falha ao salvar modelo.");
    resetModel();
    setToast(modelId ? "Modelo atualizado." : "Modelo criado.");
    await load();
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const url = deleteTarget.type === "pasta" ? "/api/modelos/pastas" : "/api/modelos";
      const response = await fetch(url, { method: "DELETE", body: JSON.stringify({ id: deleteTarget.id }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Falha ao excluir.");
      setToast(deleteTarget.type === "pasta" ? "Pasta excluída. Os modelos foram preservados." : "Modelo excluído.");
      setDeleteTarget(null);
      await load();
    } catch (error: any) {
      setToast(error.message);
    } finally {
      setDeleting(false);
    }
  }

  const fail = (error: any) => setToast(error?.message || "Algo deu errado.");

  return <AppShell title="Modelos" subtitle="Organize mensagens e pastas para seus disparos">
    {loading ? <LoadingState /> : <div className="grid gap-6 xl:grid-cols-[360px_1fr]">
      <aside className="space-y-5">
        <section className="rounded-lg border border-line bg-panel p-5 shadow-soft">
          <h2 className="font-semibold text-ink">Pastas</h2>
          <div className="mt-4 flex gap-2">
            <input value={folderName} onChange={(event) => setFolderName(event.target.value)} placeholder="Nome da nova pasta" className="focus-ring h-10 min-w-0 flex-1 rounded-lg border border-line px-3 text-sm" />
            <button type="button" title="Criar pasta" disabled={!folderName.trim()} onClick={() => saveFolder().catch(fail)} className="grid h-10 w-10 place-items-center rounded-lg bg-black text-white disabled:opacity-40"><FolderPlus size={17} /></button>
          </div>
          <div className="mt-4 space-y-2">
            {pastas.map((pasta) => <div key={pasta.id} className="flex items-center justify-between gap-2 rounded-lg border border-line p-3">
              {editingFolder?.id === pasta.id ? <input autoFocus value={editingFolder.nome} onChange={(event) => setEditingFolder({ ...editingFolder, nome: event.target.value })} className="focus-ring h-9 min-w-0 flex-1 rounded-lg border border-line px-2 text-sm" /> : <button type="button" onClick={() => setFolderFilter(pasta.id)} className="min-w-0 flex-1 truncate text-left text-sm font-medium">{pasta.nome}</button>}
              <div className="flex gap-1">
                {editingFolder?.id === pasta.id ? <><button title="Salvar nome" className="rounded-lg p-2 hover:bg-wash" onClick={() => saveFolder().catch(fail)}><Save size={15} /></button><button title="Cancelar" className="rounded-lg p-2 hover:bg-wash" onClick={() => setEditingFolder(null)}><X size={15} /></button></> : <button title="Renomear pasta" className="rounded-lg p-2 text-muted hover:bg-wash hover:text-ink" onClick={() => setEditingFolder({ ...pasta })}><FilePenLine size={15} /></button>}
                <button title="Excluir pasta" className="rounded-lg p-2 text-muted hover:bg-red-50 hover:text-red-600" onClick={() => setDeleteTarget({ type: "pasta", id: pasta.id, name: pasta.nome })}><Trash2 size={15} /></button>
              </div>
            </div>)}
            {!pastas.length ? <p className="text-sm text-muted">Nenhuma pasta criada.</p> : null}
          </div>
        </section>

        <section className="rounded-lg border border-line bg-panel p-5 shadow-soft">
          <h2 className="font-semibold text-ink">{modelId ? "Editar modelo" : "Novo modelo"}</h2>
          <div className="mt-4 space-y-3">
            <input value={modelName} onChange={(event) => setModelName(event.target.value)} placeholder="Nome do modelo" className="focus-ring h-11 w-full rounded-lg border border-line px-3 text-sm" />
            <select value={modelFolderId} onChange={(event) => setModelFolderId(event.target.value)} className="focus-ring h-11 w-full rounded-lg border border-line px-3 text-sm"><option value="">Sem pasta</option>{pastas.map((pasta) => <option key={pasta.id} value={pasta.id}>{pasta.nome}</option>)}</select>
            <select value={modelKind} onChange={(event) => setModelKind(event.target.value as MessageKind)} className="focus-ring h-11 w-full rounded-lg border border-line px-3 text-sm">{Object.entries(labels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
            {(["texto", "imagem", "video"] as MessageKind[]).includes(modelKind) ? <textarea value={modelText} onChange={(event) => setModelText(event.target.value)} rows={5} placeholder="Texto da mensagem" className="focus-ring w-full rounded-lg border border-line p-3 text-sm" /> : null}
            {modelKind !== "texto" ? <><FileDropzone onFile={setModelFile} /><MediaPreview fileName={modelFile?.name} mimeType={modelFile?.type} /></> : null}
            <div className="flex gap-2"><ActionButton icon={modelId ? <Save size={16} /> : <Plus size={16} />} disabled={!modelName.trim()} onClick={() => saveModel().catch(fail)} className="flex-1 bg-black text-white">{modelId ? "Salvar alterações" : "Criar modelo"}</ActionButton>{modelId ? <ActionButton icon={<X size={16} />} onClick={resetModel} className="border border-line bg-white text-ink">Cancelar</ActionButton> : null}</div>
          </div>
        </section>
      </aside>

      <section>
        <div className="mb-4 flex flex-col gap-3 sm:flex-row">
          <div className="flex-1"><SearchInput value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Pesquisar modelos pelo nome" /></div>
          <select aria-label="Filtrar por pasta" value={folderFilter} onChange={(event) => setFolderFilter(event.target.value)} className="focus-ring h-11 rounded-lg border border-line bg-white px-3 text-sm"><option value="all">Todas as pastas</option><option value="none">Sem pasta</option>{pastas.map((pasta) => <option key={pasta.id} value={pasta.id}>{pasta.nome}</option>)}</select>
        </div>
        {filteredModels.length ? <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">{filteredModels.map((modelo) => {
          const folder = pastas.find((pasta) => pasta.id === modelo.pasta_id);
          return <article key={modelo.id} className="rounded-lg border border-line bg-panel p-5 shadow-soft">
            <div className="flex items-start justify-between gap-3"><div className="min-w-0"><h2 className="truncate font-semibold text-ink">{modelo.nome}</h2><p className="mt-1 text-xs text-muted">{folder?.nome || "Sem pasta"} · {labels[modelo.tipo]}</p></div><div className="flex gap-1"><button title="Editar modelo" onClick={() => editModel(modelo)} className="rounded-lg p-2 text-muted hover:bg-wash hover:text-ink"><FilePenLine size={16} /></button><button title="Excluir modelo" onClick={() => setDeleteTarget({ type: "modelo", id: modelo.id, name: modelo.nome })} className="rounded-lg p-2 text-muted hover:bg-red-50 hover:text-red-600"><Trash2 size={16} /></button></div></div>
            {modelo.texto ? <p className="mt-4 line-clamp-4 whitespace-pre-wrap text-sm text-muted">{modelo.texto}</p> : <p className="mt-4 text-sm text-muted">{modelo.file_name || "Arquivo anexado"}</p>}
          </article>;
        })}</div> : <EmptyState title="Nenhum modelo encontrado" description="Crie um modelo ou ajuste os filtros para encontrar suas mensagens." />}
      </section>
    </div>}
    <ConfirmModal open={Boolean(deleteTarget)} title={`Excluir ${deleteTarget?.type || "item"}?`} onCancel={() => setDeleteTarget(null)} onConfirm={confirmDelete} confirmLabel="Excluir" loading={deleting} destructive>
      {deleteTarget?.type === "pasta" ? `A pasta “${deleteTarget.name}” será excluída. Os modelos dentro dela serão preservados sem pasta.` : `O modelo “${deleteTarget?.name}” será excluído permanentemente.`}
    </ConfirmModal>
    <Toast message={toast} />
  </AppShell>;
}
