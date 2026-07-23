"use client";

import { ActionButton, AppShell, ConfirmModal, LoadingState, Toast } from "@/components/ui";
import { ChevronRight, Loader2, Plus, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type Grupo = { group_jid: string; nome?: string; qtd_membros?: number };
type Campanha = {
  id: string;
  nome: string;
  whatsapp_sender_id?: string | null;
  numero?: { id: string; label: string; session_name: string } | null;
  grupos: Grupo[];
};
type Sender = { id: string; label: string; session_name: string; status?: string };

export default function CampanhaDetailPage({ params }: { params: { id: string } }) {
  const [campaign, setCampaign] = useState<Campanha | null>(null);
  const [senders, setSenders] = useState<Sender[]>([]);
  const [allGroups, setAllGroups] = useState<Grupo[]>([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState("");

  // Remove group
  const [removeTarget, setRemoveTarget] = useState<Grupo | null>(null);
  const [removing, setRemoving] = useState(false);

  // Add groups modal
  const [showAdd, setShowAdd] = useState(false);
  const [addQuery, setAddQuery] = useState("");
  const [addJids, setAddJids] = useState<string[]>([]);
  const [adding, setAdding] = useState(false);

  // Sender update
  const [updatingSender, setUpdatingSender] = useState(false);

  async function load() {
    const [cr, sr] = await Promise.all([fetch("/api/campanhas"), fetch("/api/whatsapp/senders")]);
    const [cd, sd] = await Promise.all([cr.json(), sr.json()]);
    const found = (Array.isArray(cd) ? cd : []).find((c: Campanha) => c.id === params.id) ?? null;
    setCampaign(found);
    setSenders(sd.senders || []);
  }

  async function loadGroupsForSender(senderId: string) {
    const url = senderId ? `/api/whatsapp/groups?sender_id=${senderId}` : "/api/whatsapp/groups";
    const data = await fetch(url).then((r) => r.json());
    setAllGroups(Array.isArray(data) ? data : []);
  }

  useEffect(() => {
    load().catch(() => {}).finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id]);

  function showMsg(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(""), 3500);
  }

  const campaignJids = useMemo(() => campaign?.grupos.map((g) => g.group_jid) ?? [], [campaign]);

  const availableGroups = useMemo(() => {
    const q = addQuery.trim().toLowerCase();
    return allGroups.filter((g) => {
      if (campaignJids.includes(g.group_jid)) return false;
      if (!q) return true;
      return `${g.nome || ""} ${g.group_jid}`.toLowerCase().includes(q);
    });
  }, [allGroups, campaignJids, addQuery]);

  async function handleRemove() {
    if (!campaign || !removeTarget) return;
    setRemoving(true);
    try {
      const newJids = campaign.grupos.map((g) => g.group_jid).filter((j) => j !== removeTarget.group_jid);
      const res = await fetch("/api/campanhas", {
        method: "PATCH",
        body: JSON.stringify({ id: campaign.id, group_jids: newJids }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Falha ao remover grupo.");
      showMsg("Grupo removido.");
      setRemoveTarget(null);
      await load();
    } catch (e: any) {
      showMsg(e.message);
    } finally {
      setRemoving(false);
    }
  }

  async function openAdd() {
    setAddQuery("");
    setAddJids([]);
    setShowAdd(true);
    await loadGroupsForSender(campaign?.whatsapp_sender_id ?? "").catch(() => {});
  }

  async function handleAdd() {
    if (!campaign || !addJids.length) return;
    setAdding(true);
    try {
      const newJids = [...campaignJids, ...addJids];
      const res = await fetch("/api/campanhas", {
        method: "PATCH",
        body: JSON.stringify({ id: campaign.id, group_jids: newJids }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Falha ao adicionar grupos.");
      showMsg(`${addJids.length} grupo(s) adicionado(s).`);
      setShowAdd(false);
      await load();
    } catch (e: any) {
      showMsg(e.message);
    } finally {
      setAdding(false);
    }
  }

  async function handleSenderChange(senderId: string) {
    if (!campaign) return;
    setUpdatingSender(true);
    try {
      const res = await fetch("/api/campanhas", {
        method: "PATCH",
        body: JSON.stringify({ id: campaign.id, whatsapp_sender_id: senderId || null }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Falha ao atualizar número.");
      showMsg("Número atualizado.");
      await load();
    } catch (e: any) {
      showMsg(e.message);
    } finally {
      setUpdatingSender(false);
    }
  }

  if (loading) return <AppShell title="Campanha"><LoadingState /></AppShell>;
  if (!campaign) return <AppShell title="Campanha"><div className="py-20 text-center text-muted">Campanha não encontrada.</div></AppShell>;

  return (
    <AppShell
      title={campaign.nome}
      subtitle={`${campaign.grupos.length} grupo(s)`}
      action={
        <ActionButton icon={<Plus size={16} />} onClick={openAdd} className="bg-black text-white hover:bg-zinc-800">
          Adicionar grupos
        </ActionButton>
      }
    >
      {/* Breadcrumb */}
      <nav className="mb-6 flex items-center gap-1.5 text-sm text-muted">
        <Link href="/campanhas" className="transition-colors hover:text-ink">Campanhas</Link>
        <ChevronRight size={14} />
        <span className="text-ink">{campaign.nome}</span>
      </nav>

      {/* Sender selector */}
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <label className="shrink-0 text-sm font-medium text-ink">Número responsável:</label>
        <select
          value={campaign.whatsapp_sender_id ?? ""}
          onChange={(e) => handleSenderChange(e.target.value).catch(() => {})}
          disabled={updatingSender}
          className="focus-ring h-10 rounded-lg border border-line bg-white px-3 text-sm disabled:opacity-60"
        >
          <option value="">Número principal</option>
          {senders.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
      </div>

      {/* Groups list */}
      {campaign.grupos.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <h2 className="text-lg font-semibold text-ink">Nenhum grupo nesta campanha</h2>
          <p className="mt-2 text-sm text-muted">Adicione grupos para poder fazer disparos.</p>
          <ActionButton icon={<Plus size={16} />} onClick={openAdd} className="mt-6 bg-black text-white hover:bg-zinc-800">
            Adicionar grupos
          </ActionButton>
        </div>
      ) : (
        <div className="divide-y divide-line rounded-lg border border-line bg-panel shadow-soft">
          {campaign.grupos.map((group) => (
            <div key={group.group_jid} className="flex items-center gap-4 px-5 py-4">
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium text-ink">{group.nome || "Sem nome"}</div>
                <div className="mt-0.5 font-mono text-xs text-muted">{group.group_jid}</div>
                {group.qtd_membros ? (
                  <div className="mt-0.5 text-xs text-muted">{group.qtd_membros} membros</div>
                ) : null}
              </div>
              <button
                type="button"
                onClick={() => setRemoveTarget(group)}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-red-200 px-3 py-1.5 text-sm text-red-600 transition hover:bg-red-50"
              >
                <X size={14} /> Remover
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Add groups modal */}
      {showAdd && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
          onClick={() => !adding && setShowAdd(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-xl bg-white shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="border-b border-line px-6 py-5">
              <h2 className="text-lg font-semibold text-ink">Adicionar grupos</h2>
            </div>

            <div className="flex-1 space-y-4 overflow-y-auto px-6 py-5">
              <input
                value={addQuery}
                onChange={(e) => setAddQuery(e.target.value)}
                placeholder="Pesquisar grupos..."
                autoFocus
                className="focus-ring h-10 w-full rounded-lg border border-line px-3 text-sm"
              />
              <div className="max-h-72 space-y-1 overflow-y-auto rounded-lg border border-line p-3">
                {availableGroups.map((g) => (
                  <label key={g.group_jid} className="flex cursor-pointer items-center gap-2 py-1 text-sm">
                    <input
                      type="checkbox"
                      checked={addJids.includes(g.group_jid)}
                      onChange={(e) =>
                        setAddJids((prev) =>
                          e.target.checked
                            ? Array.from(new Set([...prev, g.group_jid]))
                            : prev.filter((j) => j !== g.group_jid)
                        )
                      }
                    />
                    <span className="truncate">{g.nome || g.group_jid}</span>
                  </label>
                ))}
                {availableGroups.length === 0 && (
                  <div className="py-4 text-center text-sm text-muted">Nenhum grupo disponível para adicionar.</div>
                )}
              </div>
              <p className="text-sm text-muted">{addJids.length} grupo(s) selecionado(s).</p>
            </div>

            <div className="flex justify-end gap-3 border-t border-line px-6 py-4">
              <ActionButton
                disabled={adding}
                onClick={() => setShowAdd(false)}
                className="border border-line bg-white text-ink hover:bg-wash"
              >
                Cancelar
              </ActionButton>
              <ActionButton
                disabled={!addJids.length || adding}
                icon={adding ? <Loader2 size={16} className="animate-spin" /> : undefined}
                onClick={handleAdd}
                className="bg-black text-white hover:bg-zinc-800"
              >
                Adicionar selecionados
              </ActionButton>
            </div>
          </div>
        </div>
      )}

      <ConfirmModal
        open={Boolean(removeTarget)}
        title="Remover grupo?"
        confirmLabel="Remover grupo"
        onCancel={() => setRemoveTarget(null)}
        onConfirm={handleRemove}
        loading={removing}
        destructive
      >
        {`Remover "${removeTarget?.nome || removeTarget?.group_jid}" da campanha "${campaign.nome}"?`}
      </ConfirmModal>

      <Toast message={toast} />
    </AppShell>
  );
}
