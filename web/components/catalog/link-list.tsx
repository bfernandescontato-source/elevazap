"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CalendarClock, Check, ListPlus, Loader2, MessageSquareText, RotateCcw, Trash2, X } from "lucide-react";
import { DispatchTargetPicker, saveDispatchTarget, useDispatchTarget } from "@/components/catalog/dispatch-target-picker";
import { LinkGenerating } from "@/components/catalog/link-generating";
import { extractProductLinks, LIST_INTERVALS, LIST_MAX_LINKS, LIST_RESOLVE_CHUNK, LIST_SCHEDULE_CHUNK, listSlots, STORE_LABEL, type ListStart, type ListStore } from "@/modules/affiliate-catalog/link-list";
import { buildCatalogOfferMessage, catalogMessageRandom } from "@/modules/affiliate-catalog/offer-message";
import { brasiliaDate, brasiliaTime } from "@/modules/affiliate-catalog/schedule-plan";
import type { AffiliateOffer } from "@/modules/affiliate-catalog/types";

type ServerItem =
  | { input: string; status: "ready"; offer: AffiliateOffer; missingInfo: boolean }
  | { input: string; status: "pending"; offer: AffiliateOffer; missingInfo: boolean; jobId: string }
  | { input: string; status: "error"; store: ListStore | null; error: string };

type Row = {
  id: number; input: string; state: "loading" | "link" | "ready" | "error";
  offer?: AffiliateOffer; missingInfo?: boolean; jobId?: string; error?: string;
  /** Texto editado; sem ele vale a mensagem automática. */
  message?: string;
  result?: { ok: boolean; detail?: string };
};

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const money = (value?: number) => value === undefined ? "" : new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
const offerKey = (offer: AffiliateOffer) => `${offer.provider}:${offer.externalItemId}`;
const nextHour = () => { const now = new Date(Date.now() + 60 * 60_000); return `${brasiliaTime(now).slice(0, 2)}:00`; };
const autoMessage = (offer: AffiliateOffer, at: Date) => buildCatalogOfferMessage(offer, offer.affiliateUrl!, catalogMessageRandom(offer, brasiliaDate(at)));

async function postJson(url: string, body: unknown) {
  const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Não foi possível falar com o servidor.");
  return data;
}

/** Link do Mercado Livre sai pela extensão: mesma consulta do Catálogo. */
async function waitMercadoLivreLink(jobId: string) {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    await sleep(3000);
    const poll = await fetch(`/api/catalogo/link-afiliado/${jobId}`, { cache: "no-store" });
    const status = await poll.json().catch(() => ({}));
    if (!poll.ok) throw new Error(status.error || "Não foi possível consultar o link afiliado.");
    if (status.status === "completed" && status.affiliateUrl) return status.affiliateUrl as string;
    if (["failed", "expired"].includes(status.status)) throw new Error("A extensão não respondeu. Deixe o Chrome aberto e logado no Mercado Livre.");
  }
  throw new Error("A extensão demorou demais para gerar o link.");
}

export function LinkList() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const target = useDispatchTarget();
  const [text, setText] = useState("");
  const [interval, setIntervalMinutes] = useState(10);
  const [startMode, setStartMode] = useState<"now" | "at">("now");
  const [day, setDay] = useState(brasiliaDate()); const [time, setTime] = useState(nextHour);
  const [stage, setStage] = useState<"form" | "review" | "done">("form");
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState<"" | "resolving" | "scheduling">("");
  const [openMessage, setOpenMessage] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [, setTick] = useState(0);

  useEffect(() => {
    fetch(`/api/catalogo/agenda?day=${brasiliaDate()}`, { cache: "no-store" }).then(r => setEnabled(r.ok)).catch(() => setEnabled(false));
  }, []);
  // Os horários "agora" andam com o relógio enquanto a pessoa revisa.
  useEffect(() => { if (stage !== "review") return; const timer = setInterval(() => setTick(t => t + 1), 30_000); return () => clearInterval(timer); }, [stage]);

  const extracted = useMemo(() => extractProductLinks(text), [text]);
  const start: ListStart = startMode === "now" ? { mode: "now" } : { mode: "at", day, time };
  const ready = rows.filter(row => row.state === "ready" && row.offer?.affiliateUrl);
  const slots = listSlots(ready.length, start, interval);
  const slotOf = new Map(ready.map((row, index) => [row.id, slots[index]]));
  const brokenMessage = ready.some(row => row.message !== undefined && !row.message.includes(row.offer!.affiliateUrl!));
  const linkRow = rows.find(row => row.state === "link");
  const pendingCount = rows.filter(row => row.state === "link").length;
  const formReady = extracted.links.length > 0 && target.target.senderId && target.target.groupJids.length > 0 && (startMode === "now" || (day && time));

  const update = (id: number, patch: Partial<Row>) => setRows(old => old.map(row => row.id === id ? { ...row, ...patch } : row));

  const build = async () => {
    const initial: Row[] = extracted.links.map((input, id) => ({ id, input, state: "loading" }));
    setRows(initial); setStage("review"); setBusy("resolving"); setError(""); setOpenMessage(null);
    const keys = new Set<string>();
    const pending: Array<{ id: number; jobId: string }> = [];
    const settle = (row: Row, item: ServerItem) => {
      if (item.status === "error") return update(row.id, { state: "error", error: item.error });
      const key = offerKey(item.offer);
      if (keys.has(key)) return update(row.id, { state: "error", offer: item.offer, error: "Produto repetido na lista." });
      keys.add(key);
      if (item.status === "pending") { pending.push({ id: row.id, jobId: item.jobId }); return update(row.id, { state: "link", offer: item.offer, missingInfo: item.missingInfo, jobId: item.jobId }); }
      update(row.id, { state: "ready", offer: item.offer, missingInfo: item.missingInfo });
    };
    for (let index = 0; index < initial.length; index += LIST_RESOLVE_CHUNK) {
      const chunk = initial.slice(index, index + LIST_RESOLVE_CHUNK);
      try {
        const body = await postJson("/api/catalogo/lista", { links: chunk.map(row => row.input) });
        chunk.forEach((row, position) => { const item = body.items?.[position] as ServerItem | undefined; if (item) settle(row, item); else update(row.id, { state: "error", error: "Sem resposta para este link." }); });
      } catch (current) {
        const message = current instanceof Error ? current.message : "Não foi possível ler os links.";
        chunk.forEach(row => update(row.id, { state: "error", error: message }));
      }
    }
    // Mercado Livre: um link por vez, pela extensão do Chrome.
    for (const { id, jobId } of pending) {
      try {
        const affiliateUrl = await waitMercadoLivreLink(jobId);
        setRows(old => old.map(row => row.id === id && row.offer ? { ...row, state: "ready", offer: { ...row.offer, affiliateUrl } } : row));
      } catch (current) { update(id, { state: "error", error: current instanceof Error ? current.message : "Falha ao gerar o link." }); }
    }
    setBusy("");
  };

  const schedule = async () => {
    setBusy("scheduling"); setError(""); setOpenMessage(null);
    saveDispatchTarget(target.target);
    // Horários recalculados agora: a revisão pode ter levado alguns minutos.
    const fresh = listSlots(ready.length, start, interval);
    const plan = ready.map((row, index) => ({ row, at: fresh[index] }));
    for (let index = 0; index < plan.length; index += LIST_SCHEDULE_CHUNK) {
      const chunk = plan.slice(index, index + LIST_SCHEDULE_CHUNK);
      try {
        const body = await postJson("/api/catalogo/agendamentos", {
          items: chunk.map(({ row, at }) => ({ offer: row.offer, scheduledAt: at.toISOString(), ...(row.message !== undefined ? { message: row.message } : {}) })),
          senderId: target.target.senderId, groupJids: target.target.groupJids, imageMode: target.target.imageMode
        });
        const results = new Map((body.results as Array<{ key: string; ok: boolean; error?: string; scheduledAt?: string }>).map(result => [result.key, result]));
        chunk.forEach(({ row }) => {
          const result = results.get(offerKey(row.offer!));
          update(row.id, { result: result?.ok ? { ok: true, detail: brasiliaTime(new Date(result.scheduledAt!)) } : { ok: false, detail: result?.error || "Não foi possível agendar." } });
        });
      } catch (current) {
        const message = current instanceof Error ? current.message : "Não foi possível agendar.";
        chunk.forEach(({ row }) => update(row.id, { result: { ok: false, detail: message } }));
      }
    }
    setBusy(""); setStage("done");
  };

  const restart = () => { setRows([]); setStage("form"); setError(""); };

  if (enabled === null) return <p className="flex items-center gap-2 text-sm text-muted"><Loader2 className="animate-spin" size={16}/> Carregando...</p>;
  if (!enabled) return <div className="rounded-xl border border-dashed border-line bg-white p-8 text-center"><h2 className="font-semibold">A Lista de links ainda não está liberada para sua conta.</h2><p className="mt-1 text-sm text-muted">Ela chega junto com a Agenda do Catálogo.</p></div>;

  const doneCount = rows.filter(row => row.result?.ok).length;
  const failedCount = rows.filter(row => row.result && !row.result.ok).length;
  const errorCount = rows.filter(row => row.state === "error").length;

  if (stage === "form") return <div className="grid gap-5 lg:grid-cols-[1.2fr_1fr]">
    <section className="space-y-3 rounded-2xl border border-line bg-white p-4 sm:p-5">
      <div><h2 className="font-semibold">Cole os links dos produtos</h2><p className="mt-1 text-sm text-muted">Shopee, Mercado Livre, Amazon e Magalu. Um por linha ou no meio do texto. Até {LIST_MAX_LINKS} por lista.</p></div>
      <textarea value={text} onChange={e => setText(e.target.value)} rows={12} placeholder={"https://shopee.com.br/...\nhttps://www.mercadolivre.com.br/...\nhttps://amzn.to/..."} className="focus-ring w-full rounded-xl border border-line p-3 font-mono text-sm"/>
      <div className="space-y-1 text-sm">
        <p className="font-medium">{extracted.links.length === 1 ? "1 link encontrado." : `${extracted.links.length} links encontrados.`}</p>
        {extracted.repeated ? <p className="text-muted">{extracted.repeated === 1 ? "1 link repetido foi ignorado." : `${extracted.repeated} links repetidos foram ignorados.`}</p> : null}
        {extracted.overLimit ? <p className="flex items-center gap-1 text-amber-700"><AlertTriangle size={14}/> Só cabem {LIST_MAX_LINKS} por lista. {extracted.overLimit} ficaram de fora.</p> : null}
      </div>
    </section>
    <section className="space-y-5 rounded-2xl border border-line bg-white p-4 sm:p-5">
      <DispatchTargetPicker state={target}/>
      <fieldset><legend className="text-sm font-medium">Intervalo entre as ofertas</legend><select value={interval} onChange={e => setIntervalMinutes(Number(e.target.value))} className="focus-ring mt-2 h-11 w-full rounded-lg border border-line bg-white px-3">{LIST_INTERVALS.map(m => <option key={m} value={m}>{m < 60 ? `${m} minutos` : m === 60 ? "1 hora" : `${m / 60} horas`}</option>)}</select></fieldset>
      <fieldset><legend className="text-sm font-medium">Começar</legend><div className="mt-2 grid grid-cols-2 gap-2">{([["now", "Agora"], ["at", "Escolher horário"]] as const).map(([id, label]) => <button type="button" key={id} onClick={() => setStartMode(id)} className={`rounded-lg border p-3 text-sm ${startMode === id ? "border-primary bg-primary font-medium text-white" : "border-line bg-white"}`}>{label}</button>)}</div>
        {startMode === "at" ? <div className="mt-3 flex flex-wrap gap-2"><input type="date" min={brasiliaDate()} value={day} onChange={e => setDay(e.target.value)} className="focus-ring h-11 rounded-lg border border-line px-3 text-sm"/><input type="time" value={time} onChange={e => setTime(e.target.value)} className="focus-ring h-11 rounded-lg border border-line px-3 text-sm"/></div> : null}
        <p className="mt-2 text-xs text-muted">Horário de Brasília. Uma oferta por vez, para todos os grupos escolhidos. Termina sozinho.</p></fieldset>
      {target.error ? <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{target.error}</p> : null}
      <div className="mobile-action-bar"><button disabled={!formReady} onClick={build} className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-primary font-medium text-white disabled:opacity-40"><ListPlus size={18}/> Montar lista</button></div>
    </section>
  </div>;

  return <section className="space-y-4 rounded-2xl border border-line bg-white p-4 sm:p-5">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div><h2 className="font-semibold">{stage === "done" ? "Resultado da lista" : "Confira a lista"}</h2><p className="text-sm text-muted">{ready.length} {ready.length === 1 ? "oferta pronta" : "ofertas prontas"}{errorCount ? `, ${errorCount} com erro` : ""}. Uma a cada {interval < 60 ? `${interval} min` : `${interval / 60} h`}.</p></div>
      {stage === "review" && !busy ? <button onClick={restart} className="inline-flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-sm"><RotateCcw size={15}/> Voltar e editar links</button> : null}
    </div>
    {busy === "resolving" && !linkRow ? <p className="flex items-center gap-2 rounded-xl border border-line bg-wash p-3 text-sm"><Loader2 className="animate-spin" size={16}/> Lendo os links e gerando seus links afiliados...</p> : null}
    {linkRow ? <LinkGenerating current={rows.filter(row => row.offer?.provider === "MERCADO_LIVRE" && row.state !== "link").length + 1} total={rows.filter(row => row.offer?.provider === "MERCADO_LIVRE").length} provider="MERCADO_LIVRE"/> : null}
    {busy === "scheduling" ? <p className="flex items-center gap-2 rounded-xl border border-line bg-wash p-3 text-sm"><Loader2 className="animate-spin" size={16}/> Agendando... {doneCount} de {ready.length} prontas.</p> : null}
    <ol className="space-y-2">{rows.map(row => {
      const at = slotOf.get(row.id);
      const offer = row.offer;
      const message = offer?.affiliateUrl && at ? row.message ?? autoMessage(offer, at) : "";
      const missingLink = row.message !== undefined && offer?.affiliateUrl && !row.message.includes(offer.affiliateUrl);
      return <li key={row.id} className={`rounded-xl border p-3 text-sm ${row.state === "error" ? "border-red-200 bg-red-50/40" : "border-line"}`}>
        <div className="flex items-start gap-3">
          <span className="w-12 shrink-0 pt-1 text-center font-semibold tabular-nums">{row.result ? (row.result.ok ? row.result.detail : "") : at && row.state === "ready" ? brasiliaTime(at) : ""}</span>
          {offer?.imageUrl ? <img src={offer.imageUrl} alt="" className="h-12 w-12 shrink-0 rounded object-contain"/> : <span className="h-12 w-12 shrink-0 rounded bg-wash"/>}
          <div className="min-w-0 flex-1">
            <p className="line-clamp-2 font-medium">{offer?.name || row.input}</p>
            <p className="text-xs text-muted">{offer ? STORE_LABEL[offer.provider as ListStore] : ""}{offer?.priceMin ? ` · ${money(offer.priceMin)}` : ""}</p>
            {row.state === "loading" ? <p className="mt-1 flex items-center gap-1 text-xs text-muted"><Loader2 className="animate-spin" size={12}/> Lendo o link...</p> : null}
            {row.state === "link" ? <p className="mt-1 flex items-center gap-1 text-xs text-amber-700"><Loader2 className="animate-spin" size={12}/> Gerando link afiliado...</p> : null}
            {row.state === "error" ? <p className="mt-1 text-xs text-red-700">{row.error}</p> : null}
            {row.state === "ready" && !row.result ? <p className="mt-1 flex items-center gap-1 text-xs text-emerald-700"><Check size={12}/> Link afiliado pronto{row.missingInfo ? <span className="text-amber-700">. Faltam dados do produto, confira a mensagem.</span> : null}</p> : null}
            {missingLink ? <p className="mt-1 text-xs text-red-700">A mensagem precisa ter o seu link afiliado.</p> : null}
            {row.result ? <p className={`mt-1 text-xs ${row.result.ok ? "text-emerald-700" : "text-red-700"}`}>{row.result.ok ? "Agendada." : row.result.detail}</p> : null}
          </div>
          <div className="flex shrink-0 flex-col gap-1 sm:flex-row">
            {row.state === "ready" && stage === "review" ? <button type="button" disabled={busy === "scheduling"} onClick={() => setOpenMessage(openMessage === row.id ? null : row.id)} aria-expanded={openMessage === row.id} className={`inline-flex h-8 items-center gap-1 rounded-lg border px-2 text-xs ${openMessage === row.id ? "border-primary bg-wash" : "border-line"}`}><MessageSquareText size={14}/> Mensagem</button> : null}
            {stage === "review" && row.state !== "loading" && row.state !== "link" ? <button type="button" disabled={busy === "scheduling"} onClick={() => setRows(old => old.filter(item => item.id !== row.id))} aria-label="Remover da lista" className="inline-flex h-8 items-center justify-center gap-1 rounded-lg border border-line px-2 text-xs"><Trash2 size={14}/> Remover</button> : null}
            {row.result ? row.result.ok ? <Check className="text-emerald-600" size={18}/> : <X className="text-red-600" size={18}/> : null}
          </div>
        </div>
        {openMessage === row.id && message ? <div className="mt-3 space-y-2">
          <textarea value={message} onChange={e => update(row.id, { message: e.target.value })} rows={9} className="focus-ring w-full rounded-lg border border-line bg-[#e9f7ee] p-3 text-sm leading-6"/>
          {row.message !== undefined ? <button type="button" onClick={() => update(row.id, { message: undefined })} className="text-xs text-muted underline">Voltar para a mensagem automática</button> : <p className="text-xs text-muted">Mensagem automática. Você pode editar. Mantenha o link afiliado no texto.</p>}
        </div> : null}
      </li>;
    })}</ol>
    {error ? <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}
    {stage === "done" ? <div className="mobile-action-bar space-y-2">
      <div className={`rounded-xl border p-4 text-sm ${doneCount ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-red-200 bg-red-50 text-red-800"}`}>
        <p className="flex items-center gap-2 text-base font-semibold">{doneCount ? <Check size={20}/> : <X size={20}/>}{doneCount ? `${doneCount} ${doneCount === 1 ? "oferta agendada" : "ofertas agendadas"}!` : "Nenhuma oferta foi agendada."}</p>
        {failedCount ? <p className="mt-1">{failedCount} com erro. Veja o motivo na lista acima.</p> : null}
        {doneCount ? <p className="mt-1">Acompanhe e ajuste os horários na <a href="/catalogo/agenda" className="font-medium underline">Agenda</a>.</p> : null}
      </div>
      <button onClick={() => { setText(""); restart(); }} className="h-12 w-full rounded-lg bg-primary font-medium text-white">Montar outra lista</button>
    </div> : <div className="mobile-action-bar">
      {pendingCount ? <p className="mb-2 text-xs text-muted">Aguarde os links do Mercado Livre para agendar.</p> : null}
      <button disabled={Boolean(busy) || !ready.length || brokenMessage} onClick={schedule} className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-primary font-medium text-white disabled:opacity-40">{busy === "scheduling" ? <Loader2 className="animate-spin" size={18}/> : <CalendarClock size={18}/>} {busy === "scheduling" ? "Agendando..." : ready.length === 1 ? "Agendar 1 oferta" : `Agendar ${ready.length} ofertas`}</button>
    </div>}
  </section>;
}
