"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, Image as ImageIcon, Loader2, Search, X } from "lucide-react";
import type { AffiliateOffer } from "@/modules/affiliate-catalog/types";

const MAX_GROUPS = 5;
type Sender = { id: string; label: string };
type Group = { group_jid: string; nome?: string };

async function fetchStory(offer: AffiliateOffer): Promise<Blob> {
  const response = await fetch("/api/catalogo/story", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ offer }) });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.error || "Não foi possível criar o story agora.");
  }
  return response.blob();
}

/** A conta precisa estar liberada para ver "Postar no Status". */
export function useWhatsappStatusEnabled() {
  const [state, setState] = useState<{ enabled: boolean; dailyLimit: number }>({ enabled: false, dailyLimit: 10 });
  useEffect(() => {
    let cancelled = false;
    fetch("/api/catalogo/status", { cache: "no-store" }).then(r => r.ok ? r.json() : null)
      .then(body => { if (!cancelled && body) setState({ enabled: body.enabled === true, dailyLimit: Number(body.dailyLimit) || 10 }); })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, []);
  return state;
}

export function StoryDownloadButton({ offer, onError }: { offer: AffiliateOffer; onError: (message: string) => void }) {
  const [busy, setBusy] = useState(false);
  const download = async () => {
    setBusy(true);
    try {
      const url = URL.createObjectURL(await fetchStory(offer));
      const a = document.createElement("a");
      a.href = url; a.download = `story-${offer.provider.toLowerCase()}-${offer.externalItemId}.jpg`; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5_000);
    } catch (error) { onError(error instanceof Error ? error.message : "Não foi possível criar o story agora."); }
    finally { setBusy(false); }
  };
  return <button type="button" disabled={busy} onClick={download} aria-label="Baixar story" className="inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-lg border border-line bg-white px-4 text-sm disabled:opacity-50">
    {busy ? <Loader2 className="animate-spin" size={17}/> : <ImageIcon size={17}/>}<span className="hidden sm:inline">Baixar story</span>
  </button>;
}

export function StatusPostDialog({ offer, message, dailyLimit, onClose }: { offer: AffiliateOffer; message: string; dailyLimit: number; onClose: () => void }) {
  const [preview, setPreview] = useState<string | null>(null);
  const [senders, setSenders] = useState<Sender[]>([]); const [senderId, setSenderId] = useState("");
  const [groups, setGroups] = useState<Group[]>([]); const [selected, setSelected] = useState<string[]>([]); const [query, setQuery] = useState("");
  const [sending, setSending] = useState(false); const [error, setError] = useState(""); const [done, setDone] = useState(false);

  useEffect(() => {
    let url: string | null = null; let cancelled = false;
    fetchStory(offer).then(blob => { if (cancelled) return; url = URL.createObjectURL(blob); setPreview(url); }).catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : "Não foi possível criar o story agora."); });
    return () => { cancelled = true; if (url) URL.revokeObjectURL(url); };
  }, [offer]);
  useEffect(() => { fetch("/api/whatsapp/senders").then(r => r.json()).then(b => { setSenders(b.senders || []); if (b.senders?.[0]) setSenderId(b.senders[0].id); }).catch(() => undefined); }, []);
  useEffect(() => { setSelected([]); if (!senderId) { setGroups([]); return; } fetch(`/api/whatsapp/groups?sender_id=${senderId}`).then(r => r.json()).then(b => setGroups(Array.isArray(b) ? b : [])).catch(() => setGroups([])); }, [senderId]);
  const filtered = useMemo(() => groups.filter(g => (g.nome || g.group_jid).toLowerCase().includes(query.toLowerCase())), [groups, query]);
  const toggle = (jid: string) => setSelected(old => old.includes(jid) ? old.filter(id => id !== jid) : old.length >= MAX_GROUPS ? old : [...old, jid]);

  const submit = async () => {
    setSending(true); setError("");
    try {
      const response = await fetch("/api/catalogo/status", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ offer, message, senderId, audienceGroupJids: selected }) });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error || "Não foi possível postar agora.");
      setDone(true);
    } catch (e) { setError(e instanceof Error ? e.message : "Não foi possível postar agora."); }
    finally { setSending(false); }
  };

  return <div className="fixed inset-0 z-[60] bg-overlay/55 p-0 sm:p-4" role="dialog" aria-modal="true" aria-label="Postar no Status do WhatsApp">
    <div className="mx-auto flex h-full max-w-4xl flex-col overflow-hidden bg-white shadow-2xl sm:h-auto sm:max-h-full sm:rounded-2xl">
      <div className="flex items-center justify-between border-b border-line px-5 py-4">
        <h2 className="font-semibold">Postar no Status do WhatsApp</h2>
        <button type="button" onClick={onClose} aria-label="Fechar" className="grid h-9 w-9 place-items-center rounded-full border border-line"><X size={18}/></button>
      </div>
      <div className="grid flex-1 gap-5 overflow-y-auto p-5 sm:grid-cols-[minmax(0,240px)_1fr] sm:p-6">
        <div className="mx-auto w-40 sm:w-full">
          <div className="aspect-[9/16] overflow-hidden rounded-xl border border-line bg-wash">
            {preview ? <img src={preview} alt="Prévia do story" className="h-full w-full object-cover"/> : <div className="grid h-full place-items-center text-muted"><Loader2 className="animate-spin"/></div>}
          </div>
          <p className="mt-2 text-center text-xs text-muted">Prévia do story</p>
        </div>
        {done ? <div className="self-start rounded-2xl border border-emerald-200 bg-emerald-50 p-6 text-center">
          <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-emerald-600 text-white"><Check size={24}/></div>
          <p className="mt-3 text-lg font-semibold text-emerald-900">Pronto!</p>
          <p className="mt-1 text-sm text-emerald-900">O status entrou na fila do número. Ele sai em instantes.</p>
          <button type="button" onClick={onClose} className="mt-5 h-11 w-full rounded-lg bg-primary text-sm font-medium text-white">Fechar</button>
        </div> : <div className="space-y-5">
          <p className="text-sm text-muted">A arte da oferta vai para o Status do número escolhido. A legenda leva a sua mensagem com o link.</p>
          <div>
            <label htmlFor="status-sender" className="text-sm font-medium">Número</label>
            <select id="status-sender" value={senderId} onChange={e => setSenderId(e.target.value)} className="focus-ring mt-2 h-11 w-full rounded-lg border border-line bg-white px-3">
              <option value="">Selecionar número</option>{senders.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          </div>
          <div>
            <div className="flex items-center justify-between"><span className="text-sm font-medium">Quem vai ver</span><span className="text-xs text-muted">{selected.length} de {MAX_GROUPS} grupos</span></div>
            <p className="mt-1 text-xs text-muted">Escolha até {MAX_GROUPS} grupos. As pessoas desses grupos verão o seu status. Quem não tem o seu número salvo pode não ver.</p>
            <div className="relative mt-2"><Search className="absolute left-3 top-3 text-muted" size={16}/><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Pesquisar grupo" className="focus-ring h-10 w-full rounded-lg border border-line pl-9 pr-3 text-sm"/></div>
            <div className="mt-2 max-h-60 overflow-y-auto rounded-lg border border-line">
              {filtered.length ? filtered.map(g => { const on = selected.includes(g.group_jid); return <label key={g.group_jid} className={`flex min-h-11 cursor-pointer items-center gap-3 border-b border-line p-3 text-sm last:border-0 ${!on && selected.length >= MAX_GROUPS ? "opacity-50" : ""}`}>
                <input type="checkbox" checked={on} disabled={!on && selected.length >= MAX_GROUPS} onChange={() => toggle(g.group_jid)}/><span className="truncate">{g.nome || g.group_jid}</span>
              </label>; }) : <p className="p-3 text-sm text-muted">{senderId ? "Nenhum grupo encontrado." : "Escolha um número para ver os grupos."}</p>}
            </div>
          </div>
          <p className="text-xs text-muted">Limite de {dailyLimit} postagens por número por dia.</p>
          {error ? <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}
          <div className="mobile-action-bar [--bar-gutter:1.25rem] sm:[--bar-gutter:1.5rem]">
            <button type="button" disabled={sending || !senderId || !selected.length || !preview} onClick={submit} className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-primary font-medium text-white disabled:opacity-40">
              {sending ? <Loader2 className="animate-spin" size={18}/> : <Check size={18}/>} Postar agora
            </button>
          </div>
        </div>}
      </div>
    </div>
  </div>;
}
