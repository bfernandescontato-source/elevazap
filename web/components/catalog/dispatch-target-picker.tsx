"use client";

import { useEffect, useMemo, useState } from "react";
import { Search } from "lucide-react";

export type ImageMode = "original_image" | "product_link_preview";
export type DispatchTarget = { senderId: string; groupJids: string[]; imageMode: ImageMode };
type Sender = { id: string; label: string };
type Group = { group_jid: string; nome?: string };

// Mesma chave do agendamento em massa do Catálogo: número e grupos escolhidos lá aparecem aqui.
const TARGET_KEY = "disparei.catalog.bulkTarget";

function readSavedTarget(): Partial<DispatchTarget> {
  try { return JSON.parse(localStorage.getItem(TARGET_KEY) || "{}"); } catch { return {}; }
}
export function saveDispatchTarget(value: DispatchTarget) {
  try { localStorage.setItem(TARGET_KEY, JSON.stringify(value)); } catch { /* navegador sem armazenamento */ }
}

/** Número, grupos e imagem do envio (mesmas APIs do agendamento em massa). */
export function useDispatchTarget() {
  const saved = useMemo(readSavedTarget, []);
  const [senders, setSenders] = useState<Sender[]>([]); const [senderId, setSenderId] = useState("");
  const [groups, setGroups] = useState<Group[]>([]); const [groupJids, setGroupJids] = useState<string[]>([]);
  const [imageMode, setImageMode] = useState<ImageMode>(saved.imageMode === "product_link_preview" ? "product_link_preview" : "original_image");
  const [error, setError] = useState("");
  useEffect(() => {
    fetch("/api/whatsapp/senders").then(r => r.json()).then(body => {
      const list: Sender[] = body.senders || []; setSenders(list);
      setSenderId(list.some(s => s.id === saved.senderId) ? saved.senderId! : list[0]?.id || "");
    }).catch(() => setError("Não foi possível carregar seus números."));
  }, [saved]);
  useEffect(() => {
    if (!senderId) { setGroups([]); return; }
    fetch(`/api/whatsapp/groups?sender_id=${senderId}`).then(r => r.json()).then(body => {
      const list: Group[] = Array.isArray(body) ? body : []; setGroups(list);
      setGroupJids(senderId === saved.senderId ? (saved.groupJids || []).filter(jid => list.some(g => g.group_jid === jid)) : []);
    }).catch(() => setError("Não foi possível carregar seus grupos."));
  }, [senderId, saved]);
  return { senders, groups, error, target: { senderId, groupJids, imageMode } as DispatchTarget, setSenderId, setGroupJids, setImageMode };
}

export function DispatchTargetPicker({ state, disabled }: { state: ReturnType<typeof useDispatchTarget>; disabled?: boolean }) {
  const { senders, groups, target, setSenderId, setGroupJids, setImageMode } = state;
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => groups.filter(group => (group.nome || group.group_jid).toLowerCase().includes(query.toLowerCase())), [groups, query]);
  const selected = target.groupJids;
  return <div className="space-y-5">
    <div><label className="text-sm font-medium" htmlFor="target-sender">Número</label><select id="target-sender" disabled={disabled} value={target.senderId} onChange={e => setSenderId(e.target.value)} className="focus-ring mt-2 h-11 w-full rounded-lg border border-line bg-white px-3"><option value="">Selecionar número</option>{senders.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}</select></div>
    <div><div className="flex items-center justify-between"><span className="text-sm font-medium">Grupos</span><span className="text-xs text-muted">{selected.length} selecionados</span></div>
      <div className="relative mt-2"><Search className="absolute left-3 top-3 text-muted" size={16}/><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Pesquisar grupo" className="focus-ring h-10 w-full rounded-lg border border-line pl-9 pr-3 text-sm"/></div>
      <div className="mt-2 max-h-56 overflow-y-auto rounded-lg border border-line bg-white">
        <label className="flex cursor-pointer items-center gap-3 border-b border-line bg-wash p-3 text-sm font-medium"><input type="checkbox" disabled={disabled} checked={filtered.length > 0 && filtered.every(g => selected.includes(g.group_jid))} onChange={e => setGroupJids(e.target.checked ? Array.from(new Set([...selected, ...filtered.map(g => g.group_jid)])) : selected.filter(id => !filtered.some(g => g.group_jid === id)))}/> Selecionar todos os resultados</label>
        {filtered.length ? filtered.map(g => <label key={g.group_jid} className="flex cursor-pointer items-center gap-3 border-b border-line p-3 text-sm last:border-0"><input type="checkbox" disabled={disabled} checked={selected.includes(g.group_jid)} onChange={e => setGroupJids(e.target.checked ? [...selected, g.group_jid] : selected.filter(id => id !== g.group_jid))}/><span className="truncate">{g.nome || g.group_jid}</span></label>)
          : <p className="p-3 text-sm text-muted">{target.senderId ? "Nenhum grupo encontrado neste número." : "Escolha um número para ver os grupos."}</p>}
      </div></div>
    <fieldset><legend className="text-sm font-medium">Imagem</legend><div className="mt-2 grid grid-cols-2 gap-2">{([["original_image", "Imagem original"], ["product_link_preview", "Card do link"]] as const).map(([id, label]) => <button type="button" key={id} disabled={disabled} onClick={() => setImageMode(id)} className={`rounded-lg border p-3 text-sm ${target.imageMode === id ? "border-primary bg-wash font-medium" : "border-line bg-white"}`}>{label}</button>)}</div></fieldset>
  </div>;
}
