"use client";

import { ActionButton, AppShell, ConfirmModal, LoadingState, Toast } from "@/components/ui";
import { ChevronRight, Loader2, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

type Grupo = { group_jid: string; nome?: string; qtd_membros?: number };
type Campanha = {
  id: string;
  nome: string;
  whatsapp_sender_id?: string | null;
  numero?: { id: string; label: string; session_name: string } | null;
  created_at?: string;
  grupos: Grupo[];
};
type Sender = { id: string; label: string; session_name: string; status?: string };

const PRINCIPAL = "__principal__";

export default function CampanhasPage() {
  const router = useRouter();
  const [campaigns, setCampaigns] = useState<Campanha[]>([]);
  const [senders, setSenders] = useState<Sender[]>([]);
  const [groups, setGroups] = useState<Grupo[]>([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState("");

  const [filterSenderId, setFilterSenderId] = useState("");

  // Create modal
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newSenderId, setNewSenderId] = useState("");
  const [newGroupQuery, setNewGroupQuery] = useState("");
  const [newGroupJids, setNewGroupJids] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);
  const nameInputRef = useRef<HTMLInputElement>(null);

  // Three-dot menu
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);

  // Rename modal
  const [renameTarget, setRenameTarget] = useState<Campanha | null>(null);
  const [renameName, setRenameName] = useState("");
  const [renaming, setRenaming] = useState(false);
  const renameInputRef = useRef<HTMLInputElement>(null);

  // Delete confirm
  const [deleteTarget, setDeleteTarget] = useState<Campanha | null>(null);
  const [deleting, setDeleting] = useState(false);

  async function loadAll() {
    const [cr, sr] = await Promise.all([fetch("/api/campanhas"), fetch("/api/whatsapp/senders")]);
    const [cd, sd] = await Promise.all([cr.json(), sr.json()]);
    setCampaigns(Array.isArray(cd) ? cd : []);
    setSenders(sd.senders || []);
  }

  async function loadGroupsForSender(senderId: string) {
    const url = senderId ? `/api/whatsapp/groups?sender_id=${senderId}` : "/api/whatsapp/groups";
    const data = await fetch(url).then((r) => r.json());
    setGroups(Array.isArray(data) ? data : []);
  }

  useEffect(() => {
    loadAll().catch(() => {}).finally(() => setLoading(false));
  }, []);

  function showMsg(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(""), 3500);
  }

  const filteredCampaigns = useMemo(() => {
    if (!filterSenderId) return campaigns;
    if (filterSenderId === PRINCIPAL) return campaigns.filter((c) => !c.whatsapp_sender_id);
    return campaigns.filter((c) => c.whatsapp_sender_id === filterSenderId);
  }, [campaigns, filterSenderId]);

  const filteredCreateGroups = useMemo(() => {
    const q = newGroupQuery.trim().toLowerCase();
    if (!q) return groups;
    return groups.filter((g) => `${g.nome || ""} ${g.group_jid}`.toLowerCase().includes(q));
  }, [groups, newGroupQuery]);

  async function openCreate() {
    setNewName("");
    setNewSenderId("");
    setNewGroupQuery("");
    setNewGroupJids([]);
    setShowCreate(true);
    await loadGroupsForSender("").catch(() => {});
    setTimeout(() => nameInputRef.current?.focus(), 60);
  }

  async function handleNewSenderChange(senderId: string) {
    setNewSenderId(senderId);
    setNewGroupJids([]);
    await loadGroupsForSender(senderId).catch(() => {});
  }

  async function handleCreate() {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const res = await fetch("/api/campanhas", {
        method: "POST",
        body: JSON.stringify({ nome: newName.trim(), group_jids: newGroupJids, whatsapp_sender_id: newSenderId || null }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Falha ao criar campanha.");
      showMsg("Campanha criada.");
      setShowCreate(false);
      await loadAll();
    } catch (e: any) {
      showMsg(e.message);
    } finally {
      setCreating(false);
    }
  }

  async function handleRename() {
    if (!renameTarget || !renameName.trim()) return;
    setRenaming(true);
    try {
      const res = await fetch("/api/campanhas", {
        method: "PATCH",
        body: JSON.stringify({ id: renameTarget.id, nome: renameName.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Falha ao renomear.");
      showMsg("Campanha renomeada.");
      setRenameTarget(null);
      await loadAll();
    } catch (e: any) {
      showMsg(e.message);
    } finally {
      setRenaming(false);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await fetch("/api/campanhas", {
        method: "DELETE",
        body: JSON.stringify({ id: deleteTarget.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Falha ao excluir.");
      showMsg("Campanha excluída.");
      setDeleteTarget(null);
      await loadAll();
    } catch (e: any) {
      showMsg(e.message);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <AppShell
      title="Campanhas"
      subtitle="Organize grupos por campanha para facilitar os disparos"
      action={
        <ActionButton icon={<Plus size={16} />} onClick={openCreate} className="bg-black text-white hover:bg-zinc-800">
          Nova campanha
        </ActionButton>
      }
    >
      {/* Sender filter */}
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <label className="shrink-0 text-sm font-medium text-ink">Filtrar por número:</label>
        <select
          value={filterSenderId}
          onChange={(e) => setFilterSenderId(e.target.value)}
          className="focus-ring h-10 rounded-lg border border-line bg-white px-3 text-sm"
        >
          <option value="">Todos os números</option>
          <option value={PRINCIPAL}>Número principal</option>
          {senders.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
      </div>

      {loading ? <LoadingState /> : (
        <>
          {filteredCampaigns.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-24 text-center">
              <h2 className="text-lg font-semibold text-ink">Nenhuma campanha encontrada</h2>
              <p className="mt-2 max-w-xs text-sm text-muted">
                {filterSenderId ? "Sem campanhas para este número." : "Crie a primeira campanha para começar."}
              </p>
              {!filterSenderId && (
                <ActionButton icon={<Plus size={16} />} onClick={openCreate} className="mt-6 bg-black text-white hover:bg-zinc-800">
                  Criar primeira campanha
                </ActionButton>
              )}
            </div>
          ) : (
            <div className="divide-y divide-line rounded-lg border border-line bg-panel shadow-soft">
              {filteredCampaigns.map((campaign) => (
                <div
                  key={campaign.id}
                  className="relative flex cursor-pointer items-center gap-4 px-5 py-4 transition hover:bg-wash"
                  onClick={() => router.push(`/campanhas/${campaign.id}`)}
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-semibold text-ink">{campaign.nome}</div>
                    <div className="mt-0.5 text-sm text-muted">
                      {campaign.numero?.label || "Número principal"} · {campaign.grupos.length} grupo(s)
                    </div>
                  </div>

                  <ChevronRight size={16} className="shrink-0 text-muted" />

                  {/* Three-dot menu */}
                  <button
                    type="button"
                    aria-label="Opções da campanha"
                    className="relative z-10 rounded-lg p-1.5 text-muted hover:bg-wash hover:text-ink"
                    onClick={(e) => {
                      e.stopPropagation();
                      setMenuOpenId(menuOpenId === campaign.id ? null : campaign.id);
                    }}
                  >
                    <MoreHorizontal size={18} />
                  </button>

                  {menuOpenId === campaign.id && (
                    <div
                      className="absolute right-2 top-14 z-20 min-w-[168px] rounded-lg border border-line bg-white py-1 shadow-lg"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        type="button"
                        className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm hover:bg-wash"
                        onClick={() => {
                          setMenuOpenId(null);
                          setRenameTarget(campaign);
                          setRenameName(campaign.nome);
                          setTimeout(() => renameInputRef.current?.focus(), 60);
                        }}
                      >
                        <Pencil size={14} /> Renomear
                      </button>
                      <button
                        type="button"
                        className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm text-red-600 hover:bg-red-50"
                        onClick={() => {
                          setMenuOpenId(null);
                          setDeleteTarget(campaign);
                        }}
                      >
                        <Trash2 size={14} /> Excluir campanha
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {menuOpenId && (
            <div className="fixed inset-0 z-[15]" onClick={() => setMenuOpenId(null)} />
          )}
        </>
      )}

      {/* Create modal */}
      {showCreate && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
          onClick={() => !creating && setShowCreate(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-xl bg-white shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="border-b border-line px-6 py-5">
              <h2 className="text-lg font-semibold text-ink">Nova campanha</h2>
            </div>

            <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
              <div>
                <label className="text-sm font-medium text-ink">Nome da campanha</label>
                <input
                  ref={nameInputRef}
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="Ex.: Promoção de sexta"
                  onKeyDown={(e) => { if (e.key === "Enter" && !creating && newName.trim()) handleCreate(); }}
                  className="focus-ring mt-1 h-11 w-full rounded-lg border border-line px-3 text-sm"
                />
              </div>

              <div>
                <label className="text-sm font-medium text-ink">Número responsável</label>
                <select
                  value={newSenderId}
                  onChange={(e) => handleNewSenderChange(e.target.value).catch(() => {})}
                  className="focus-ring mt-1 h-11 w-full rounded-lg border border-line bg-white px-3 text-sm"
                >
                  <option value="">Número principal</option>
                  {senders.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                </select>
              </div>

              <div>
                <label className="text-sm font-medium text-ink">
                  Grupos <span className="text-muted">({newGroupJids.length} selecionado(s))</span>
                </label>
                <input
                  value={newGroupQuery}
                  onChange={(e) => setNewGroupQuery(e.target.value)}
                  placeholder="Pesquisar grupos..."
                  className="focus-ring mb-2 mt-1 h-10 w-full rounded-lg border border-line px-3 text-sm"
                />
                <div className="max-h-48 space-y-1 overflow-y-auto rounded-lg border border-line p-3">
                  {filteredCreateGroups.map((g) => (
                    <label key={g.group_jid} className="flex cursor-pointer items-center gap-2 py-1 text-sm">
                      <input
                        type="checkbox"
                        checked={newGroupJids.includes(g.group_jid)}
                        onChange={(e) =>
                          setNewGroupJids((prev) =>
                            e.target.checked
                              ? Array.from(new Set([...prev, g.group_jid]))
                              : prev.filter((j) => j !== g.group_jid)
                          )
                        }
                      />
                      <span className="truncate">{g.nome || g.group_jid}</span>
                    </label>
                  ))}
                  {filteredCreateGroups.length === 0 && (
                    <div className="py-4 text-center text-sm text-muted">Nenhum grupo disponível.</div>
                  )}
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-3 border-t border-line px-6 py-4">
              <ActionButton
                disabled={creating}
                onClick={() => setShowCreate(false)}
                className="border border-line bg-white text-ink hover:bg-wash"
              >
                Cancelar
              </ActionButton>
              <ActionButton
                disabled={!newName.trim() || creating}
                icon={creating ? <Loader2 size={16} className="animate-spin" /> : undefined}
                onClick={handleCreate}
                className="bg-black text-white hover:bg-zinc-800"
              >
                Criar campanha
              </ActionButton>
            </div>
          </div>
        </div>
      )}

      {/* Rename modal */}
      {renameTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
          onClick={() => !renaming && setRenameTarget(null)}
        >
          <div
            role="dialog"
            aria-modal="true"
            className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-semibold text-ink">Renomear campanha</h2>
            <div className="mt-5">
              <label className="text-sm font-medium text-ink">Nome</label>
              <input
                ref={renameInputRef}
                value={renameName}
                onChange={(e) => setRenameName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !renaming && renameName.trim()) handleRename();
                  if (e.key === "Escape") setRenameTarget(null);
                }}
                className="focus-ring mt-1 h-11 w-full rounded-lg border border-line px-3 text-sm"
              />
            </div>
            <div className="mt-6 flex justify-end gap-3">
              <ActionButton
                disabled={renaming}
                onClick={() => setRenameTarget(null)}
                className="border border-line bg-white text-ink hover:bg-wash"
              >
                Cancelar
              </ActionButton>
              <ActionButton
                disabled={!renameName.trim() || renaming}
                icon={renaming ? <Loader2 size={16} className="animate-spin" /> : undefined}
                onClick={handleRename}
                className="bg-black text-white hover:bg-zinc-800"
              >
                Salvar
              </ActionButton>
            </div>
          </div>
        </div>
      )}

      <ConfirmModal
        open={Boolean(deleteTarget)}
        title="Excluir campanha?"
        confirmLabel="Excluir campanha"
        onCancel={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        loading={deleting}
        destructive
      >
        {`Tem certeza de que deseja excluir a campanha "${deleteTarget?.nome}"? Os grupos não serão afetados.`}
      </ConfirmModal>

      <Toast message={toast} />
    </AppShell>
  );
}
