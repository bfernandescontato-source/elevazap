"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CalendarClock, Check, Loader2, Search, X } from "lucide-react";
import type { AffiliateOffer } from "@/modules/affiliate-catalog/types";
import { addDays, brasiliaDate, brasiliaTime, everyInterval, spreadInDay } from "@/modules/affiliate-catalog/schedule-plan";

type Sender = { id: string; label: string };
type Group = { group_jid: string; nome?: string };
type DayChoice = "today" | "tomorrow" | "date";
type RowState = { state: "waiting" | "link" | "saving" | "done" | "failed"; detail?: string };

const TARGET_KEY = "disparei.catalog.bulkTarget";
const CHUNK = 5;
const offerKey = (offer: AffiliateOffer) => `${offer.provider}:${offer.externalItemId}`;
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

function readSavedTarget(): { senderId?: string; groupJids?: string[]; imageMode?: string } {
  try { return JSON.parse(localStorage.getItem(TARGET_KEY) || "{}"); } catch { return {}; }
}
function saveTarget(value: object) {
  try { localStorage.setItem(TARGET_KEY, JSON.stringify(value)); } catch { /* navegador sem armazenamento */ }
}

/** Mesmo mecanismo do "Criar oferta": Shopee já traz o link; Mercado Livre passa pela extensão. */
async function ensureAffiliateUrl(offer: AffiliateOffer): Promise<string> {
  if (offer.affiliateUrl) return offer.affiliateUrl;
  const response = await fetch("/api/catalogo/link-afiliado", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ offer }) });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "Não foi possível gerar o link afiliado.");
  if (body.affiliateUrl) return body.affiliateUrl;
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    await sleep(3000);
    const poll = await fetch(`/api/catalogo/link-afiliado/${body.jobId}`, { cache: "no-store" });
    const status = await poll.json();
    if (!poll.ok) throw new Error(status.error || "Não foi possível consultar o link afiliado.");
    if (status.status === "completed" && status.affiliateUrl) return status.affiliateUrl;
    if (["failed", "expired"].includes(status.status)) throw new Error(status.error || "A extensão não respondeu. Confira se o Chrome está aberto e logado no Mercado Livre.");
  }
  throw new Error("A extensão demorou demais para gerar o link.");
}

export function BulkScheduleDialog({ offers, initialDay = "today", onClose, onDone }: { offers: AffiliateOffer[]; initialDay?: DayChoice; onClose: () => void; onDone: (scheduledKeys: string[]) => void }) {
  const saved = useMemo(readSavedTarget, []);
  const [senders, setSenders] = useState<Sender[]>([]); const [senderId, setSenderId] = useState("");
  const [groups, setGroups] = useState<Group[]>([]); const [selectedGroups, setSelectedGroups] = useState<string[]>([]); const [query, setQuery] = useState("");
  const [imageMode, setImageMode] = useState<"original_image" | "product_link_preview">(saved.imageMode === "product_link_preview" ? "product_link_preview" : "original_image");
  const [dayChoice, setDayChoice] = useState<DayChoice>(initialDay); const [customDay, setCustomDay] = useState(addDays(brasiliaDate(), 1));
  const [timing, setTiming] = useState<"spread" | "interval">("spread"); const [firstTime, setFirstTime] = useState("08:00"); const [interval, setIntervalMinutes] = useState(30);
  const [duplicates, setDuplicates] = useState<Set<string>>(new Set()); const [skipDuplicates, setSkipDuplicates] = useState(true);
  const [rows, setRows] = useState<Record<string, RowState>>({}); const [running, setRunning] = useState(false); const [finished, setFinished] = useState(false); const [error, setError] = useState("");

  const today = brasiliaDate();
  const day = dayChoice === "today" ? today : dayChoice === "tomorrow" ? addDays(today, 1) : customDay;
  const toSchedule = useMemo(() => offers.filter(offer => !(skipDuplicates && duplicates.has(offerKey(offer)))), [offers, duplicates, skipDuplicates]);
  const slots = useMemo(() => timing === "spread" ? spreadInDay(toSchedule.length, day) : everyInterval(toSchedule.length, day, firstTime, interval), [timing, toSchedule.length, day, firstTime, interval]);
  const filteredGroups = useMemo(() => groups.filter(group => (group.nome || group.group_jid).toLowerCase().includes(query.toLowerCase())), [groups, query]);

  useEffect(() => { fetch("/api/whatsapp/senders").then(r => r.json()).then(body => { const list: Sender[] = body.senders || []; setSenders(list); setSenderId(list.some(s => s.id === saved.senderId) ? saved.senderId! : list[0]?.id || ""); }).catch(() => setError("Não foi possível carregar seus números.")); }, [saved]);
  useEffect(() => {
    if (!senderId) { setGroups([]); return; }
    fetch(`/api/whatsapp/groups?sender_id=${senderId}`).then(r => r.json()).then(body => {
      const list: Group[] = Array.isArray(body) ? body : []; setGroups(list);
      setSelectedGroups(senderId === saved.senderId ? (saved.groupJids || []).filter(jid => list.some(g => g.group_jid === jid)) : []);
    });
  }, [senderId, saved]);
  useEffect(() => {
    if (!day) return;
    fetch("/api/catalogo/agendamentos", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ day, items: offers.map(o => ({ provider: o.provider, externalItemId: o.externalItemId })) }) })
      .then(r => r.ok ? r.json() : { scheduled: [] }).then(body => setDuplicates(new Set(body.scheduled || []))).catch(() => setDuplicates(new Set()));
  }, [day, offers]);

  const setRow = (key: string, value: RowState) => setRows(old => ({ ...old, [key]: value }));
  const run = async () => {
    if (!slots || !slots.length) return;
    setRunning(true); setError("");
    saveTarget({ senderId, groupJids: selectedGroups, imageMode });
    const plan = toSchedule.map((offer, index) => ({ offer, at: slots[index] }));
    plan.forEach(({ offer }) => setRow(offerKey(offer), { state: "waiting" }));
    const done: string[] = [];
    for (let start = 0; start < plan.length; start += CHUNK) {
      const ready: Array<{ offer: AffiliateOffer; scheduledAt: string }> = [];
      for (const { offer, at } of plan.slice(start, start + CHUNK)) {
        const key = offerKey(offer);
        try {
          if (!offer.affiliateUrl) setRow(key, { state: "link", detail: "Gerando link afiliado..." });
          const affiliateUrl = await ensureAffiliateUrl(offer);
          // Link do Mercado Livre pode demorar; horário que passou vai para daqui a 2 minutos.
          const when = at.getTime() < Date.now() + 60_000 ? new Date(Date.now() + 120_000) : at;
          ready.push({ offer: { ...offer, affiliateUrl }, scheduledAt: when.toISOString() });
          setRow(key, { state: "saving" });
        } catch (current) { setRow(key, { state: "failed", detail: current instanceof Error ? current.message : "Falha ao gerar o link." }); }
      }
      if (!ready.length) continue;
      try {
        const response = await fetch("/api/catalogo/agendamentos", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ items: ready, senderId, groupJids: selectedGroups, imageMode }) });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "Não foi possível agendar.");
        for (const result of body.results as Array<{ key: string; ok: boolean; error?: string; scheduledAt?: string }>) {
          if (result.ok) { done.push(result.key); setRow(result.key, { state: "done", detail: brasiliaTime(new Date(result.scheduledAt!)) }); }
          else setRow(result.key, { state: "failed", detail: result.error });
        }
      } catch (current) {
        const message = current instanceof Error ? current.message : "Não foi possível agendar.";
        ready.forEach(({ offer }) => setRow(offerKey(offer), { state: "failed", detail: message }));
      }
    }
    setRunning(false); setFinished(true); onDone(done);
  };

  const doneCount = Object.values(rows).filter(row => row.state === "done").length;
  const failedCount = Object.values(rows).filter(row => row.state === "failed").length;
  const canRun = !running && !finished && senderId && selectedGroups.length > 0 && slots && slots.length > 0;
  const dayLabel = new Intl.DateTimeFormat("pt-BR", { weekday: "long", day: "2-digit", month: "2-digit", timeZone: "UTC" }).format(new Date(`${day}T12:00:00Z`));

  return <div className="fixed inset-0 z-50 bg-black/55 p-0 sm:p-4"><div className="mx-auto flex h-full max-w-5xl flex-col overflow-hidden bg-white shadow-2xl sm:rounded-2xl">
    <div className="flex items-center justify-between border-b border-line px-5 py-4"><div><h2 className="text-lg font-semibold">Agendar {offers.length} {offers.length === 1 ? "oferta" : "ofertas"}</h2><p className="text-xs text-muted">Mensagem automática no modelo fixo (gancho, De/Por e link afiliado).</p></div><button disabled={running} onClick={onClose} className="grid h-9 w-9 place-items-center rounded-full border border-line disabled:opacity-40"><X size={18}/></button></div>
    <div className="grid flex-1 overflow-y-auto lg:grid-cols-[1fr_1fr]">
      <div className="space-y-5 border-b border-line p-5 lg:border-b-0 lg:border-r">
        <div><label className="text-sm font-medium">Número</label><select disabled={running || finished} value={senderId} onChange={e => setSenderId(e.target.value)} className="focus-ring mt-2 h-11 w-full rounded-lg border border-line bg-white px-3"><option value="">Selecionar número</option>{senders.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}</select></div>
        <div><div className="flex items-center justify-between"><label className="text-sm font-medium">Grupos</label><span className="text-xs text-muted">{selectedGroups.length} selecionados</span></div>
          <div className="relative mt-2"><Search className="absolute left-3 top-3 text-muted" size={16}/><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Pesquisar grupo" className="focus-ring h-10 w-full rounded-lg border border-line pl-9 pr-3 text-sm"/></div>
          <div className="mt-2 max-h-56 overflow-y-auto rounded-lg border border-line"><label className="flex cursor-pointer items-center gap-3 border-b border-line bg-wash p-3 text-sm font-medium"><input type="checkbox" disabled={running || finished} checked={filteredGroups.length > 0 && filteredGroups.every(g => selectedGroups.includes(g.group_jid))} onChange={e => setSelectedGroups(e.target.checked ? Array.from(new Set([...selectedGroups, ...filteredGroups.map(g => g.group_jid)])) : selectedGroups.filter(id => !filteredGroups.some(g => g.group_jid === id)))}/> Selecionar todos os resultados</label>
            {filteredGroups.map(g => <label key={g.group_jid} className="flex cursor-pointer items-center gap-3 border-b border-line p-3 text-sm last:border-0"><input type="checkbox" disabled={running || finished} checked={selectedGroups.includes(g.group_jid)} onChange={e => setSelectedGroups(e.target.checked ? [...selectedGroups, g.group_jid] : selectedGroups.filter(id => id !== g.group_jid))}/><span className="truncate">{g.nome || g.group_jid}</span></label>)}</div></div>
        <fieldset><legend className="text-sm font-medium">Imagem</legend><div className="mt-2 grid grid-cols-2 gap-2">{([["original_image", "Imagem original"], ["product_link_preview", "Card do link"]] as const).map(([id, label]) => <button key={id} disabled={running || finished} onClick={() => setImageMode(id)} className={`rounded-lg border p-3 text-sm ${imageMode === id ? "border-black bg-wash font-medium" : "border-line"}`}>{label}</button>)}</div></fieldset>
        <fieldset><legend className="text-sm font-medium">Dia</legend><div className="mt-2 flex flex-wrap gap-2">{([["today", "Hoje"], ["tomorrow", "Amanhã"], ["date", "Outra data"]] as const).map(([id, label]) => <button key={id} disabled={running || finished} onClick={() => setDayChoice(id)} className={`rounded-lg border px-4 py-2 text-sm ${dayChoice === id ? "border-black bg-black text-white" : "border-line"}`}>{label}</button>)}{dayChoice === "date" && <input type="date" min={today} value={customDay} disabled={running || finished} onChange={e => setCustomDay(e.target.value)} className="focus-ring h-10 rounded-lg border border-line px-3 text-sm"/>}</div><p className="mt-2 text-xs capitalize text-muted">{dayLabel}</p></fieldset>
        <fieldset><legend className="text-sm font-medium">Horários</legend><div className="mt-2 grid grid-cols-2 gap-2"><button disabled={running || finished} onClick={() => setTiming("spread")} className={`rounded-lg border p-3 text-left text-sm ${timing === "spread" ? "border-black bg-wash font-medium" : "border-line"}`}>Espalhar entre 07h e 22h</button><button disabled={running || finished} onClick={() => setTiming("interval")} className={`rounded-lg border p-3 text-left text-sm ${timing === "interval" ? "border-black bg-wash font-medium" : "border-line"}`}>Intervalo fixo</button></div>
          {timing === "interval" && <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">A partir das <input type="time" value={firstTime} onChange={e => setFirstTime(e.target.value)} className="focus-ring h-10 rounded-lg border border-line px-2"/> a cada <select value={interval} onChange={e => setIntervalMinutes(Number(e.target.value))} className="focus-ring h-10 rounded-lg border border-line px-2">{[5, 10, 15, 20, 30, 45, 60, 90, 120].map(m => <option key={m} value={m}>{m < 60 ? `${m} min` : `${m / 60} h`}</option>)}</select></div>}</fieldset>
      </div>
      <div className="flex flex-col p-5">
        <div className="flex items-center justify-between"><h3 className="font-semibold">Prévia</h3>{duplicates.size > 0 && <label className="flex items-center gap-2 text-xs"><input type="checkbox" disabled={running || finished} checked={skipDuplicates} onChange={e => setSkipDuplicates(e.target.checked)}/> Pular {duplicates.size} já agendada{duplicates.size > 1 ? "s" : ""} neste dia</label>}</div>
        {slots === null ? <p className="mt-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">Hoje já passou das 22h. Escolha amanhã ou outra data.</p> : null}
        <ol className="mt-3 flex-1 space-y-2 overflow-y-auto">{offers.map(offer => { const key = offerKey(offer); const index = toSchedule.indexOf(offer); const row = rows[key]; const skipped = index < 0;
          return <li key={key} className={`flex items-center gap-3 rounded-lg border p-2 text-sm ${skipped ? "border-dashed border-line opacity-50" : "border-line"}`}>
            <span className="w-12 shrink-0 text-center font-semibold tabular-nums">{row?.state === "done" ? row.detail : skipped || !slots ? "—" : brasiliaTime(slots[index])}</span>
            {offer.imageUrl ? <img src={offer.imageUrl} alt="" className="h-10 w-10 shrink-0 rounded object-contain"/> : null}
            <span className="min-w-0 flex-1"><span className="line-clamp-1">{offer.name}</span>{skipped ? <span className="text-xs text-muted">Já agendada neste dia</span> : duplicates.has(key) ? <span className="flex items-center gap-1 text-xs text-amber-700"><AlertTriangle size={12}/> Já agendada neste dia</span> : row?.detail && row.state !== "done" ? <span className={`text-xs ${row.state === "failed" ? "text-red-700" : "text-muted"}`}>{row.detail}</span> : null}</span>
            <span className="shrink-0">{row?.state === "done" ? <Check className="text-emerald-600" size={18}/> : row?.state === "failed" ? <X className="text-red-600" size={18}/> : row && row.state !== "waiting" ? <Loader2 className="animate-spin text-muted" size={18}/> : null}</span>
          </li>; })}</ol>
        {error && <p className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        {finished ? <div className="mobile-action-bar mt-4 space-y-2"><p className="rounded-lg bg-zinc-100 p-3 text-sm">{doneCount} agendada{doneCount === 1 ? "" : "s"}{failedCount ? ` · ${failedCount} com erro (veja acima)` : ""}. Acompanhe na aba Agenda.</p><button onClick={onClose} className="h-12 w-full rounded-lg bg-black font-medium text-white">Fechar</button></div>
          : <div className="mobile-action-bar mt-4"><button disabled={!canRun} onClick={run} className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-black font-medium text-white disabled:opacity-40">{running ? <Loader2 className="animate-spin" size={18}/> : <CalendarClock size={18}/>} {running ? "Agendando..." : `Agendar ${toSchedule.length} para ${dayChoice === "today" ? "hoje" : dayChoice === "tomorrow" ? "amanhã" : "o dia escolhido"}`}</button></div>}
      </div>
    </div>
  </div></div>;
}
