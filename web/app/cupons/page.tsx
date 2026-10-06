"use client";

import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/ui";
import { Check, Loader2, Search, Send, Star, Store, Tag, X } from "lucide-react";

type Offer = { id: string; kind: "loja" | "shopee"; name: string; imageUrl: string | null; offerLink: string; commissionRate: number; ratingStar: number | null };
type Sender = { id: string; label: string };
type Group = { group_jid: string; nome?: string };

function mensagemPadrao(o: Offer) {
  return [`🛍️ ${o.name}`, `💰 Comissão de ${o.commissionRate}% na Shopee`, `🛒 ${o.offerLink}`, "⏰ Aproveite, oferta por tempo limitado!"].join("\n");
}

function EnviarDialog({ offer, onClose }: { offer: Offer; onClose: () => void }) {
  const [senders, setSenders] = useState<Sender[]>([]); const [senderId, setSenderId] = useState("");
  const [groups, setGroups] = useState<Group[]>([]); const [selected, setSelected] = useState<string[]>([]); const [query, setQuery] = useState("");
  const [message, setMessage] = useState(mensagemPadrao(offer));
  const [enviando, setEnviando] = useState(false); const [erro, setErro] = useState(""); const [feito, setFeito] = useState("");

  useEffect(() => { fetch("/api/whatsapp/senders").then(r => r.json()).then(b => { const l: Sender[] = b.senders || []; setSenders(l); if (l[0]) setSenderId(l[0].id); }).catch(() => setErro("Não foi possível carregar seus números.")); }, []);
  useEffect(() => { if (!senderId) { setGroups([]); return; } fetch(`/api/whatsapp/groups?sender_id=${senderId}`).then(r => r.json()).then(b => { setGroups(Array.isArray(b) ? b : []); setSelected([]); }); }, [senderId]);
  const filtrados = useMemo(() => groups.filter(g => (g.nome || g.group_jid).toLowerCase().includes(query.toLowerCase())), [groups, query]);

  const enviar = async () => {
    setEnviando(true); setErro("");
    try {
      const r = await fetch("/api/cupons/enviar", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ offerLink: offer.offerLink, name: offer.name, imageUrl: offer.imageUrl || undefined, message, senderId, groupJids: selected }) });
      const b = await r.json(); if (!r.ok) throw new Error(b.error || "Falha ao enviar.");
      setFeito(`Enviado para ${b.total} ${b.total === 1 ? "grupo" : "grupos"}.`);
    } catch (e) { setErro(e instanceof Error ? e.message : "Falha ao enviar."); } finally { setEnviando(false); }
  };

  return <div className="fixed inset-0 z-50 bg-overlay/55 p-0 sm:p-4"><div className="mx-auto flex h-full max-w-2xl flex-col overflow-hidden bg-white shadow-2xl sm:rounded-2xl">
    <div className="flex items-center justify-between border-b border-line px-5 py-4"><div><h2 className="font-semibold">Enviar oferta</h2><p className="text-xs text-muted">{offer.name} · {offer.commissionRate}% de comissão</p></div><button onClick={onClose} className="grid h-9 w-9 place-items-center rounded-full border border-line"><X size={18}/></button></div>
    {feito ? <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center"><Check className="text-emerald-600" size={40}/><p className="font-semibold">{feito}</p><button onClick={onClose} className="rounded-lg bg-primary px-5 py-2 text-sm font-medium text-white">Fechar</button></div>
      : <>
      <div className="flex-1 space-y-4 overflow-y-auto p-5">
        <div><label className="text-sm font-medium">Número</label><select value={senderId} onChange={e => setSenderId(e.target.value)} className="focus-ring mt-2 h-11 w-full rounded-lg border border-line bg-white px-3"><option value="">Selecionar número</option>{senders.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}</select></div>
        <div><div className="flex items-center justify-between"><label className="text-sm font-medium">Grupos de destino</label><span className="text-xs text-muted">{selected.length} selecionados</span></div>
          <div className="relative mt-2"><Search className="absolute left-3 top-3 text-muted" size={16}/><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Pesquisar grupo" className="focus-ring h-10 w-full rounded-lg border border-line pl-9 pr-3 text-sm"/></div>
          <div className="mt-2 max-h-48 overflow-y-auto rounded-lg border border-line"><label className="flex cursor-pointer items-center gap-3 border-b border-line bg-wash p-3 text-sm font-medium"><input type="checkbox" checked={filtrados.length > 0 && filtrados.every(g => selected.includes(g.group_jid))} onChange={e => setSelected(e.target.checked ? Array.from(new Set([...selected, ...filtrados.map(g => g.group_jid)])) : selected.filter(id => !filtrados.some(g => g.group_jid === id)))}/> Selecionar todos</label>
            {filtrados.map(g => <label key={g.group_jid} className="flex cursor-pointer items-center gap-3 border-b border-line p-3 text-sm last:border-0"><input type="checkbox" checked={selected.includes(g.group_jid)} onChange={e => setSelected(e.target.checked ? [...selected, g.group_jid] : selected.filter(id => id !== g.group_jid))}/><span className="truncate">{g.nome || g.group_jid}</span></label>)}</div></div>
        <div><label className="text-sm font-medium">Mensagem (já vem pronta, edite se quiser)</label>
          <textarea value={message} onChange={e => setMessage(e.target.value)} rows={5} className="focus-ring mt-2 w-full rounded-lg border border-line p-3 text-sm font-sans leading-6"/>
          <p className="mt-2 rounded-lg bg-wash p-3 text-xs leading-5 text-muted">A imagem da oferta vai junto. O link já é o seu, rastreado, então a comissão é sua. Mantenha o link no texto.</p></div>
        {erro ? <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{erro}</p> : null}
      </div>
      <div className="border-t border-line p-4"><button disabled={enviando || !senderId || !selected.length || !message.trim()} onClick={enviar} className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-primary font-medium text-white disabled:opacity-40">{enviando ? <Loader2 className="animate-spin" size={18}/> : <Send size={18}/>} {enviando ? "Enviando..." : `Enviar agora para ${selected.length} ${selected.length === 1 ? "grupo" : "grupos"}`}</button></div>
    </>}
  </div></div>;
}

export default function OfertasShopeePage() {
  const [offers, setOffers] = useState<Offer[]>([]);
  const [estado, setEstado] = useState<"carregando" | "ok" | "bloqueado" | "erro">("carregando");
  const [msgErro, setMsgErro] = useState("");
  const [tipo, setTipo] = useState<"todas" | "loja" | "shopee">("todas");
  const [enviar, setEnviar] = useState<Offer | null>(null);

  useEffect(() => {
    fetch("/api/cupons", { cache: "no-store" }).then(async r => {
      const b = await r.json().catch(() => ({}));
      if (r.status === 403) { setEstado("bloqueado"); return; }
      if (!r.ok) { setMsgErro(b.error || "Não foi possível carregar."); setEstado("erro"); return; }
      setOffers(b.offers || []); setEstado("ok");
    }).catch(() => setEstado("erro"));
  }, []);

  const visiveis = tipo === "todas" ? offers : offers.filter(o => o.kind === tipo);

  return <AppShell title="Ofertas Shopee" subtitle="Ofertas e lojas da Shopee com comissão alta. Envie para seus grupos com imagem e seu link de afiliado.">
    {estado === "carregando" ? <div className="flex items-center gap-2 text-sm text-muted"><Loader2 className="animate-spin" size={16}/> Carregando ofertas...</div>
      : estado === "bloqueado" ? <div className="rounded-xl border border-line bg-white p-8 text-center"><Tag className="mx-auto text-muted"/><h2 className="mt-3 font-semibold">Área ainda não liberada para sua conta.</h2></div>
      : estado === "erro" ? <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-sm text-red-800">{msgErro || "Não foi possível carregar as ofertas agora."}</div>
      : !offers.length ? <div className="rounded-xl border border-dashed border-line bg-white p-12 text-center"><Tag className="mx-auto text-muted"/><h2 className="mt-3 font-semibold">Nenhuma oferta no momento.</h2></div>
      : <div className="space-y-4">
        <div className="flex gap-2">{([["todas", "Todas"], ["loja", "Lojas"], ["shopee", "Shopee"]] as const).map(([id, label]) => <button key={id} onClick={() => setTipo(id)} className={`rounded-full border px-4 py-2 text-sm ${tipo === id ? "border-primary bg-primary text-white" : "border-line bg-white text-muted"}`}>{label}</button>)}</div>
        <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4 2xl:grid-cols-5">{visiveis.map(o => <article key={o.id} className="flex flex-col overflow-hidden rounded-xl border border-line bg-white shadow-sm">
          <div className="relative aspect-square bg-wash"><span className="absolute left-2 top-2 z-10 rounded-full bg-[#ee4d2d] px-2 py-0.5 text-[10px] font-bold uppercase text-white">{o.kind === "loja" ? "Loja" : "Shopee"}</span>{o.imageUrl ? <img src={o.imageUrl} alt={o.name} className="h-full w-full object-contain"/> : <div className="grid h-full place-items-center text-muted"><Store/></div>}</div>
          <div className="flex flex-1 flex-col p-3"><h2 className="line-clamp-2 min-h-10 text-sm font-medium">{o.name}</h2>
            <div className="mt-2 flex items-center gap-2"><span className="rounded-lg border border-emerald-100 bg-emerald-50 px-2 py-1 text-xs font-bold text-emerald-700">{o.commissionRate}% comissão</span>{o.ratingStar ? <span className="inline-flex items-center gap-1 text-xs text-muted"><Star className="fill-amber-400 text-amber-400" size={12}/>{o.ratingStar.toFixed(1)}</span> : null}</div>
            <button onClick={() => setEnviar(o)} className="mt-3 inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-primary text-sm font-semibold text-white"><Send size={15}/> Enviar para grupos</button>
          </div>
        </article>)}</div>
      </div>}
    {enviar ? <EnviarDialog offer={enviar} onClose={() => setEnviar(null)}/> : null}
  </AppShell>;
}
