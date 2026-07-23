"use client";

import { ActionButton, AppShell, ConfirmModal, LoadingState, Toast } from "@/components/ui";
import { Folder, FolderPlus, Loader2, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type Pasta = { id: string; nome: string; updated_at?: string | null };
type ModeloCount = { id: string; pasta_id?: string | null };

function formatPastaDate(dateStr?: string | null): string {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  const now = new Date();
  const days = Math.floor((now.getTime() - d.getTime()) / 86400000);
  if (days === 0) return "Atualizada hoje";
  if (days === 1) return "Atualizada ontem";
  if (days < 7) return `Atualizada há ${days} dias`;
  return `Atualizada em ${d.toLocaleDateString("pt-BR")}`;
}

export default function ModelosPage() {
  const router = useRouter();
  const [pastas, setPastas] = useState<Pasta[]>([]);
  const [allModelos, setAllModelos] = useState<ModeloCount[]>([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState("");
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [showFolderModal, setShowFolderModal] = useState(false);
  const [modalFolderName, setModalFolderName] = useState("");
  const [renamingFolder, setRenamingFolder] = useState<Pasta | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Pasta | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const modalInputRef = useRef<HTMLInputElement>(null);

  const modelCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const m of allModelos) {
      if (m.pasta_id) counts[m.pasta_id] = (counts[m.pasta_id] || 0) + 1;
    }
    return counts;
  }, [allModelos]);

  async function load() {
    const [pr, mr] = await Promise.all([fetch("/api/modelos/pastas"), fetch("/api/modelos")]);
    const [p, m] = await Promise.all([pr.json(), mr.json()]);
    if (!pr.ok) throw new Error(p.error || "Falha ao carregar pastas.");
    setPastas(Array.isArray(p) ? p : []);
    setAllModelos(Array.isArray(m) ? m : []);
  }

  useEffect(() => {
    load().catch((e: any) => setToast(e.message)).finally(() => setLoading(false));
  }, []);

  function showMsg(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(""), 3500);
  }

  function openCreate() {
    setRenamingFolder(null);
    setModalFolderName("");
    setShowFolderModal(true);
    setTimeout(() => modalInputRef.current?.focus(), 60);
  }

  function openRename(pasta: Pasta) {
    setRenamingFolder(pasta);
    setModalFolderName(pasta.nome);
    setShowFolderModal(true);
    setTimeout(() => modalInputRef.current?.focus(), 60);
  }

  function closeModal() {
    setShowFolderModal(false);
    setRenamingFolder(null);
    setModalFolderName("");
  }

  async function handleSaveFolder() {
    if (!modalFolderName.trim()) return;
    setSaving(true);
    try {
      const method = renamingFolder ? "PATCH" : "POST";
      const body = renamingFolder
        ? { id: renamingFolder.id, nome: modalFolderName.trim() }
        : { nome: modalFolderName.trim() };
      const res = await fetch("/api/modelos/pastas", { method, body: JSON.stringify(body) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Falha ao salvar pasta.");
      showMsg(renamingFolder ? "Pasta renomeada." : "Pasta criada.");
      closeModal();
      await load();
    } catch (e: any) {
      showMsg(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteFolder() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await fetch("/api/modelos/pastas", {
        method: "DELETE",
        body: JSON.stringify({ id: deleteTarget.id })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Falha ao excluir pasta.");
      showMsg("Pasta excluída.");
      setDeleteTarget(null);
      await load();
    } catch (e: any) {
      showMsg(e.message);
    } finally {
      setDeleting(false);
    }
  }

  const deleteCount = deleteTarget ? (modelCounts[deleteTarget.id] || 0) : 0;

  return (
    <AppShell
      title="Modelos"
      subtitle="Organize seus modelos de mensagens em pastas"
      action={
        <ActionButton
          icon={<FolderPlus size={16} />}
          onClick={openCreate}
          className="bg-black text-white hover:bg-zinc-800"
        >
          Nova pasta
        </ActionButton>
      }
    >
      {loading ? <LoadingState /> : (
        <>
          {!pastas.length ? (
            <div className="flex flex-col items-center justify-center py-24 text-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-full border border-line bg-panel mb-4">
                <Folder size={28} className="text-muted" />
              </div>
              <h2 className="text-lg font-semibold text-ink">Você ainda não criou nenhuma pasta</h2>
              <p className="mt-2 max-w-xs text-sm text-muted">
                Crie uma pasta para começar a organizar seus modelos de mensagens.
              </p>
              <ActionButton
                icon={<FolderPlus size={16} />}
                onClick={openCreate}
                className="mt-6 bg-black text-white hover:bg-zinc-800"
              >
                Criar primeira pasta
              </ActionButton>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {pastas.map((pasta) => {
                const count = modelCounts[pasta.id] || 0;
                return (
                  <div
                    key={pasta.id}
                    role="button"
                    tabIndex={0}
                    className="relative cursor-pointer rounded-lg border border-line bg-panel p-5 shadow-soft transition hover:border-zinc-300 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-black/10"
                    onClick={() => router.push(`/grupos/modelos/${pasta.id}`)}
                    onKeyDown={(e) => e.key === "Enter" && router.push(`/grupos/modelos/${pasta.id}`)}
                  >
                    {/* Three-dot menu */}
                    <button
                      type="button"
                      aria-label="Opções da pasta"
                      className="absolute right-3 top-3 z-10 rounded-lg p-1.5 text-muted hover:bg-wash hover:text-ink"
                      onClick={(e) => {
                        e.stopPropagation();
                        setMenuOpenId(menuOpenId === pasta.id ? null : pasta.id);
                      }}
                    >
                      <MoreHorizontal size={18} />
                    </button>

                    {menuOpenId === pasta.id && (
                      <div className="absolute right-2 top-10 z-20 min-w-[168px] rounded-lg border border-line bg-white py-1 shadow-lg">
                        <button
                          type="button"
                          className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm hover:bg-wash"
                          onClick={(e) => {
                            e.stopPropagation();
                            setMenuOpenId(null);
                            openRename(pasta);
                          }}
                        >
                          <Pencil size={14} /> Renomear pasta
                        </button>
                        <button
                          type="button"
                          className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm text-red-600 hover:bg-red-50"
                          onClick={(e) => {
                            e.stopPropagation();
                            setMenuOpenId(null);
                            setDeleteTarget(pasta);
                          }}
                        >
                          <Trash2 size={14} /> Excluir pasta
                        </button>
                      </div>
                    )}

                    <Folder size={28} className="mb-3 text-zinc-500" />
                    <h3 className="truncate pr-7 font-semibold text-ink">{pasta.nome}</h3>
                    <p className="mt-1 text-sm text-muted">
                      {count} {count === 1 ? "modelo" : "modelos"}
                    </p>
                    {pasta.updated_at && (
                      <p className="mt-1 text-xs text-muted">{formatPastaDate(pasta.updated_at)}</p>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {menuOpenId && (
            <div className="fixed inset-0 z-[15]" onClick={() => setMenuOpenId(null)} />
          )}
        </>
      )}

      {/* Create / Rename modal */}
      {showFolderModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
          onClick={() => !saving && closeModal()}
        >
          <div
            role="dialog"
            aria-modal="true"
            className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-semibold text-ink">
              {renamingFolder ? "Renomear pasta" : "Criar nova pasta"}
            </h2>
            <div className="mt-5">
              <label className="text-sm font-medium text-ink">Nome da pasta</label>
              <input
                ref={modalInputRef}
                value={modalFolderName}
                onChange={(e) => setModalFolderName(e.target.value)}
                placeholder="Ex.: Ofertas do TikTok"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !saving && modalFolderName.trim()) handleSaveFolder();
                  if (e.key === "Escape") closeModal();
                }}
                className="focus-ring mt-1 h-11 w-full rounded-lg border border-line px-3 text-sm"
              />
            </div>
            <div className="mt-6 flex justify-end gap-3">
              <ActionButton
                disabled={saving}
                onClick={closeModal}
                className="border border-line bg-white text-ink hover:bg-wash"
              >
                Cancelar
              </ActionButton>
              <ActionButton
                disabled={!modalFolderName.trim() || saving}
                icon={saving ? <Loader2 size={16} className="animate-spin" /> : undefined}
                onClick={handleSaveFolder}
                className="bg-black text-white hover:bg-zinc-800"
              >
                {renamingFolder ? "Salvar" : "Criar pasta"}
              </ActionButton>
            </div>
          </div>
        </div>
      )}

      <ConfirmModal
        open={Boolean(deleteTarget)}
        title={deleteCount > 0 ? "Excluir pasta e modelos?" : "Excluir pasta?"}
        confirmLabel={deleteCount > 0 ? "Excluir pasta e modelos" : "Excluir pasta"}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={handleDeleteFolder}
        loading={deleting}
        destructive
      >
        {deleteCount > 0
          ? `Esta pasta possui ${deleteCount} ${deleteCount === 1 ? "modelo" : "modelos"}. Ao excluir a pasta, todos os modelos dentro dela também serão apagados. Essa ação não poderá ser desfeita.`
          : `Tem certeza de que deseja excluir a pasta "${deleteTarget?.nome}"?`}
      </ConfirmModal>

      <Toast message={toast} />
    </AppShell>
  );
}
