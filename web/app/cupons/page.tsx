"use client";

import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/ui";
import { Check, Clipboard, ExternalLink, Loader2, Search, Send, Ticket, X } from "lucide-react";

type Coupon = { promotionId: string; code: string; boldText: string; lightText: string; iconText: string; labels: string[]; redirectUrl: string; collectionId: string | null; endTime: number | null; percentageUsed: number | null };
type Sender = { id: string; label: string };
type Group = { group_jid: string; nome?: string };

function validade(endTime: number | null) {
  if (!endTime) return "";
  const dias = Math.round((endTime * 1000 - Date.now()) / 86_400_000);
  if (dias <= 0) return "acaba hoje"; if (dias === 1) return "acaba amanhã"; return `acaba em ${dias} dias`;
}

function EnviarDialog({ coupon, onClose }: { coupon: Coupon; onClose: () => void }) {
  const [senders, setSenders] = useState<Sender[]>([]); const [senderId, setSenderId] = useState("");
  const [groups, setGroups] = useState<Group[]>([]); const [selected, setSelected] = useState<string[]>([]); const [query, setQuery] = useState("");
  const [message, setMessage] = useState(""); const [preparando, setPreparando] = useState(true);
  const [enviando, setEnviando] = useState(false); const [erro, setErro] = useState(""); const [feito, setFeito] = useState("");

  useEffect(() => { fetch("/api/whatsapp/senders").then(r => r.json()).then(b => { const l: Sender[] = b.senders || []; setSenders(l); if (l[0]) setSenderId(l[0].id); }).catch(() => setErro("Não foi possível carregar seus números.")); }, []);
  // Já traz a mensagem pronta do cupom (com o link de afiliado), para a pessoa só ajustar.
  useEffect(() => {
    setPreparando(true);
    fetch("/api/cupons/preparar", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ promotionId: coupon.promotionId }) })
      .then(async r => { const b = await r.json(); if (!r.ok) throw new Error(b.error); setMessage(b.message || ""); })
      .catch(e => setErro(e instanceof Error ? e.message : "Não foi possível preparar a mensagem."))
      .finally(() => setPreparando(false));
  }, [coupon.promotionId]);
  useEffect(() => { if (!senderId) { setGroups([]); return; } fetch(`/api/whatsapp/groups?sender_id=${senderId}`).then(r => r.json()).then(b => { setGroups(Array.isArray(b) ? b : []); setSelected([]); }); }, [senderId]);
  const filtrados = useMemo(() => groups.filter(g => (g.nome || g.group_jid).toLowerCase().includes(query.toLowerCase())), [groups, query]);

  const enviar = async () => {
    setEnviando(true); setErro("");
    try {
      const r = await fetch("/api/cupons/enviar", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ promotionId: coupon.promotionId, senderId, groupJids: selected, message }) });
      const b = await r.json(); if (!r.ok) throw new Error(b.error || "Falha ao enviar.");
      setFeito(`Cupom enviado para ${b.total} ${b.total === 1 ? "grupo" : "grupos"}.`);
    } catch (e) { setErro(e instanceof Error ? e.message : "Falha ao enviar."); } finally { setEnviando(false); }
  };

  return <div className="fixed inset-0 z-50 bg-overlay/55 p-0 sm:p-4"><div className="mx-auto flex h-full max-w-2xl flex-col overflow-hidden bg-white shadow-2xl sm:rounded-2xl">
    <div className="flex items-center justify-between border-b border-line px-5 py-4"><div><h2 className="font-semibold">Enviar cupom</h2><p className="text-xs text-muted">{coupon.boldText} · código {coupon.code}</p></div><button onClick={onClose} className="grid h-9 w-9 place-items-center rounded-full border border-line"><X size={18}/></button></div>
    {feito ? <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center"><Check className="text-emerald-600" size={40}/><p className="font-semibold">{feito}</p><button onClick={onClose} className="rounded-lg bg-primary px-5 py-2 text-sm font-medium text-white">Fechar</button></div>
      : <>
      <div className="flex-1 space-y-4 overflow-y-auto p-5">
        <div><label className="text-sm font-medium">Número</label><select value={senderId} onChange={e => setSenderId(e.target.value)} className="focus-ring mt-2 h-11 w-full rounded-lg border border-line bg-white px-3"><option value="">Selecionar número</option>{senders.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}</select></div>
        <div><div className="flex items-center justify-between"><label className="text-sm font-medium">Grupos de destino</label><span className="text-xs text-muted">{selected.length} selecionados</span></div>
          <div className="relative mt-2"><Search className="absolute left-3 top-3 text-muted" size={16}/><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Pesquisar grupo" className="focus-ring h-10 w-full rounded-lg border border-line pl-9 pr-3 text-sm"/></div>
          <div className="mt-2 max-h-52 overflow-y-auto rounded-lg border border-line"><label className="flex cursor-pointer items-center gap-3 border-b border-line bg-wash p-3 text-sm font-medium"><input type="checkbox" checked={filtrados.length > 0 && filtrados.every(g => selected.includes(g.group_jid))} onChange={e => setSelected(e.target.checked ? Array.from(new Set([...selected, ...filtrados.map(g => g.group_jid)])) : selected.filter(id => !filtrados.some(g => g.group_jid === id)))}/> Selecionar todos</label>
            {filtrados.map(g => <label key={g.group_jid} className="flex cursor-pointer items-center gap-3 border-b border-line p-3 text-sm last:border-0"><input type="checkbox" checked={selected.includes(g.group_jid)} onChange={e => setSelected(e.target.checked ? [...selected, g.group_jid] : selected.filter(id => id !== g.group_jid))}/><span className="truncate">{g.nome || g.group_jid}</span></label>)}</div></div>
        <div><label className="text-sm font-medium">Mensagem (já vem pronta, edite se quiser)</label>
          {preparando ? <div className="mt-2 flex items-center gap-2 rounded-lg border border-line bg-wash p-3 text-sm text-muted"><Loader2 className="animate-spin" size={15}/> Gerando a mensagem com o seu link de afiliado...</div>
            : <textarea value={message} onChange={e => setMessage(e.target.value)} rows={6} className="focus-ring mt-2 w-full rounded-lg border border-line p-3 text-sm font-sans leading-6"/>}
          <p className="mt-2 rounded-lg bg-wash p-3 text-xs leading-5 text-muted">O link já é o seu, rastreado, então a comissão é sua. Pode editar o texto, mas mantenha o link para receber a comissão.</p></div>
        {erro ? <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{erro}</p> : null}
      </div>
      <div className="border-t border-line p-4"><button disabled={enviando || !senderId || !selected.length || preparando || !message.trim()} onClick={enviar} className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-primary font-medium text-white disabled:opacity-40">{enviando ? <Loader2 className="animate-spin" size={18}/> : <Send size={18}/>} {enviando ? "Enviando..." : `Enviar agora para ${selected.length} ${selected.length === 1 ? "grupo" : "grupos"}`}</button></div>
    </>}
  </div></div>;
}

export default function CuponsPage() {
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [estado, setEstado] = useState<"carregando" | "ok" | "bloqueado" | "erro">("carregando");
  const [copiado, setCopiado] = useState<string | null>(null);
  const [colecao, setColecao] = useState<string>("todas");
  const [enviar, setEnviar] = useState<Coupon | null>(null);

  useEffect(() => {
    fetch("/api/cupons", { cache: "no-store" }).then(async r => {
      if (r.status === 403) { setEstado("bloqueado"); return; }
      if (!r.ok) { setEstado("erro"); return; }
      const body = await r.json(); setCoupons(body.coupons || []); setEstado("ok");
    }).catch(() => setEstado("erro"));
  }, []);

  const colecoes = useMemo(() => Array.from(new Set(coupons.map(c => c.iconText).filter(Boolean))), [coupons]);
  const visiveis = colecao === "todas" ? coupons : coupons.filter(c => c.iconText === colecao);
  const copiar = async (code: string) => { try { await navigator.clipboard.writeText(code); setCopiado(code); setTimeout(() => setCopiado(c => c === code ? null : c), 2000); } catch { /* sem clipboard */ } };

  return <AppShell title="Cupons Shopee" subtitle="Cupons do dia da Shopee. Envie direto para seus grupos com seu link de afiliado.">
    {estado === "carregando" ? <div className="flex items-center gap-2 text-sm text-muted"><Loader2 className="animate-spin" size={16}/> Carregando cupons...</div>
      : estado === "bloqueado" ? <div className="rounded-xl border border-line bg-white p-8 text-center"><Ticket className="mx-auto text-muted"/><h2 className="mt-3 font-semibold">Área de cupons ainda não liberada para sua conta.</h2></div>
      : estado === "erro" ? <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-sm text-red-800">Não foi possível carregar os cupons agora.</div>
      : !coupons.length ? <div className="rounded-xl border border-dashed border-line bg-white p-12 text-center"><Ticket className="mx-auto text-muted"/><h2 className="mt-3 font-semibold">Nenhum cupom no momento.</h2><p className="mt-1 text-sm text-muted">Os cupons são atualizados pela extensão na coleta do dia.</p></div>
      : <div className="space-y-4">
        {colecoes.length > 1 ? <div className="flex gap-2 overflow-x-auto pb-1">{["todas", ...colecoes].map(c => <button key={c} onClick={() => setColecao(c)} className={`shrink-0 rounded-full border px-4 py-2 text-sm ${colecao === c ? "border-primary bg-primary text-white" : "border-line bg-white text-muted"}`}>{c === "todas" ? "Todos" : c}</button>)}</div> : null}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">{visiveis.map(c => <article key={c.promotionId} className="flex flex-col justify-between rounded-xl border border-line bg-white p-4 shadow-sm">
          <div>
            <div className="flex flex-wrap items-center gap-2"><span className="rounded-full bg-[#ee4d2d] px-2 py-0.5 text-[10px] font-bold uppercase text-white">{c.iconText || "Cupom"}</span>{c.labels.slice(0, 1).map(l => <span key={l} className="rounded-full bg-wash px-2 py-0.5 text-[10px] font-medium text-muted">{l}</span>)}</div>
            <h2 className="mt-2 text-lg font-bold text-ink">{c.boldText}</h2>{c.lightText ? <p className="text-sm text-muted">{c.lightText}</p> : null}
            <p className="mt-2 text-xs text-muted">Código: <strong>{c.code}</strong> · {validade(c.endTime)}</p>
          </div>
          <div className="mt-4 grid grid-cols-1 gap-2">
            <button onClick={() => setEnviar(c)} className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-white"><Send size={15}/> Enviar para grupos</button>
            <div className="flex gap-2">
              <button onClick={() => copiar(c.code)} className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg border border-line px-3 py-2 text-xs font-medium">{copiado === c.code ? <><Check size={14}/> Copiado</> : <><Clipboard size={14}/> Copiar código</>}</button>
              {c.redirectUrl ? <a href={c.redirectUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center justify-center gap-1 rounded-lg border border-line px-3 py-2 text-xs font-medium"><ExternalLink size={14}/> Shopee</a> : null}
            </div>
          </div>
        </article>)}</div>
      </div>}
    {enviar ? <EnviarDialog coupon={enviar} onClose={() => setEnviar(null)}/> : null}
  </AppShell>;
}
