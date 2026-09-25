"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, Clock, Loader2, MessageSquareText, RefreshCw, Send, ShoppingBag, Trash2 } from "lucide-react";
import { addDays, brasiliaDate, brasiliaInstant, brasiliaTime, sameTimeTomorrow, spreadAcrossDays, spreadInDay } from "@/modules/affiliate-catalog/schedule-plan";

type Status = "programado" | "enviando" | "enviado" | "parcial" | "erro" | "incerto" | "pausado";
type Item = {
  id: string; provider: string; productName: string; imageUrl: string | null; price: number | null; originalPrice: number | null;
  message: string; groupCount: number; scheduledAt: string; status: Status; sent: number; failed: number; pending: number;
};
type Change = { id: string; scheduledAt: string };

const STATUS: Record<Status, { label: string; className: string }> = {
  programado: { label: "Programado", className: "bg-sky-50 text-sky-800" },
  enviando: { label: "Enviando", className: "bg-amber-50 text-amber-800" },
  enviado: { label: "Enviado", className: "bg-emerald-50 text-emerald-800" },
  parcial: { label: "Enviado com falhas", className: "bg-orange-50 text-orange-800" },
  erro: { label: "Erro", className: "bg-red-50 text-red-700" },
  incerto: { label: "Confirmar envio", className: "bg-violet-50 text-violet-800" },
  pausado: { label: "Pausado", className: "bg-zinc-100 text-zinc-700" }
};
const FILTERS = [["all", "Todas"], ["pending", "Não enviadas"], ["sent", "Enviadas"], ["failed", "Com erro"]] as const;
const money = (value: number | null) => value === null ? "" : new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
const matchesFilter = (item: Item, filter: typeof FILTERS[number][0]) =>
  filter === "all" || (filter === "pending" && ["programado", "enviando", "pausado"].includes(item.status)) ||
  (filter === "sent" && ["enviado", "parcial"].includes(item.status)) || (filter === "failed" && ["erro", "parcial", "incerto"].includes(item.status));

export function CatalogAgenda() {
  const today = brasiliaDate();
  const [day, setDay] = useState(today);
  const [items, setItems] = useState<Item[]>([]); const [loading, setLoading] = useState(true); const [error, setError] = useState("");
  const [filter, setFilter] = useState<typeof FILTERS[number][0]>("all"); const [provider, setProvider] = useState("ALL");
  const [busy, setBusy] = useState<string | null>(null); const [notice, setNotice] = useState("");
  const [spreadDays, setSpreadDays] = useState(2); const [keepTimes, setKeepTimes] = useState(false);
  const [openMessage, setOpenMessage] = useState<string | null>(null);
  const loadingRef = useRef(false);

  const load = useCallback(async (quiet = false) => {
    if (loadingRef.current) return; loadingRef.current = true; if (!quiet) setLoading(true);
    try {
      const response = await fetch(`/api/catalogo/agenda?day=${day}`, { cache: "no-store" }); const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Não foi possível carregar a agenda.");
      setItems(body.items || []); setError("");
    } catch (current) { setError(current instanceof Error ? current.message : "Não foi possível carregar a agenda."); }
    finally { loadingRef.current = false; setLoading(false); }
  }, [day]);
  useEffect(() => { void load(); }, [load]);
  // Recarrega a cada 30 s e ao voltar para a aba, como a Agenda do Motor Mercado.
  useEffect(() => {
    const refresh = () => { if (document.visibilityState === "visible") void load(true); };
    const timer = setInterval(refresh, 30_000);
    window.addEventListener("focus", refresh); document.addEventListener("visibilitychange", refresh);
    return () => { clearInterval(timer); window.removeEventListener("focus", refresh); document.removeEventListener("visibilitychange", refresh); };
  }, [load]);

  const visible = useMemo(() => items.filter(item => matchesFilter(item, filter) && (provider === "ALL" || item.provider === provider)), [items, filter, provider]);
  const upcoming = useMemo(() => items.filter(item => item.status === "programado"), [items]);
  const summary = { total: items.length, sent: items.filter(item => ["enviado", "parcial"].includes(item.status)).length, scheduled: upcoming.length, next: upcoming[0]?.scheduledAt };

  const apply = async (label: string, changes: Change[]) => {
    if (!changes.length) return;
    setBusy(label); setNotice("");
    try {
      const response = await fetch("/api/catalogo/agenda", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ changes }) });
      const body = await response.json(); if (!response.ok) throw new Error(body.error || "Não foi possível mudar os horários.");
      const failed = (body.results as Array<{ ok: boolean; error?: string }>).filter(result => !result.ok);
      setNotice(failed.length ? `${changes.length - failed.length} atualizada(s); ${failed.length} não mudou: ${failed[0].error}` : changes.length === 1 ? "Horário atualizado." : `${changes.length} horários atualizados.`);
    } catch (current) { setNotice(current instanceof Error ? current.message : "Não foi possível mudar os horários."); }
    finally { setBusy(null); await load(true); }
  };
  const remove = async (item: Item) => {
    if (!window.confirm(`Remover "${item.productName}" da fila? Os envios que ainda não saíram serão cancelados.`)) return;
    setBusy(item.id); setNotice("");
    try {
      const response = await fetch("/api/catalogo/agenda", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: item.id }) });
      const body = await response.json(); if (!response.ok) throw new Error(body.error || "Não foi possível remover.");
      setNotice("Oferta removida da fila.");
    } catch (current) { setNotice(current instanceof Error ? current.message : "Não foi possível remover."); }
    finally { setBusy(null); await load(true); }
  };

  // Ações em massa valem só para as ofertas que ainda não saíram, na ordem atual.
  const startNow = () => { const slots = spreadInDay(upcoming.length, today); if (!slots) return setNotice("Hoje já passou das 22h."); void apply("start", upcoming.map((item, i) => ({ id: item.id, scheduledAt: slots[i].toISOString() }))); };
  const spreadDay = () => { const slots = spreadInDay(upcoming.length, day); if (!slots) return setNotice("Não sobra horário entre 07h e 22h neste dia."); void apply("spread", upcoming.map((item, i) => ({ id: item.id, scheduledAt: slots[i].toISOString() }))); };
  const redistribute = () => {
    if (keepTimes) {
      const perDay = Math.ceil(upcoming.length / spreadDays);
      return void apply("days", upcoming.map((item, i) => { const at = new Date(item.scheduledAt); at.setTime(at.getTime() + Math.floor(i / perDay) * 86_400_000); return { id: item.id, scheduledAt: at.toISOString() }; }));
    }
    const slots = spreadAcrossDays(upcoming.length, day, spreadDays); if (!slots) return setNotice("Não sobra horário entre 07h e 22h no primeiro dia.");
    void apply("days", upcoming.map((item, i) => ({ id: item.id, scheduledAt: slots[i].toISOString() })));
  };

  const dayTitle = day === today ? "Hoje" : day === addDays(today, 1) ? "Amanhã" : new Intl.DateTimeFormat("pt-BR", { weekday: "long", day: "2-digit", month: "2-digit", timeZone: "UTC" }).format(new Date(`${day}T12:00:00Z`));

  return <div className="space-y-5">
    <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={() => setDay(addDays(day, -1))} className="grid h-10 w-10 place-items-center rounded-lg border border-line bg-white" aria-label="Dia anterior"><ChevronLeft size={18}/></button>
        {[[today, "Hoje"], [addDays(today, 1), "Amanhã"]].map(([value, label]) => <button key={value} onClick={() => setDay(value)} className={`h-10 rounded-lg border px-4 text-sm ${day === value ? "border-black bg-black text-white" : "border-line bg-white"}`}>{label}</button>)}
        <input type="date" value={day} onChange={e => e.target.value && setDay(e.target.value)} className="focus-ring h-10 rounded-lg border border-line bg-white px-3 text-sm"/>
        <button onClick={() => setDay(addDays(day, 1))} className="grid h-10 w-10 place-items-center rounded-lg border border-line bg-white" aria-label="Próximo dia"><ChevronRight size={18}/></button>
        <button onClick={() => load()} className="grid h-10 w-10 place-items-center rounded-lg border border-line bg-white" aria-label="Recarregar"><RefreshCw size={16}/></button>
      </div>
      <p className="text-sm text-muted"><strong className="capitalize text-ink">{dayTitle}</strong> · {summary.total} ofertas · {summary.sent} enviadas · {summary.scheduled} programadas{summary.next ? ` · próxima às ${brasiliaTime(new Date(summary.next))}` : ""}</p>
    </div>

    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex flex-wrap gap-2">{FILTERS.map(([id, label]) => <button key={id} onClick={() => setFilter(id)} className={`rounded-full border px-3 py-1.5 text-sm ${filter === id ? "border-black bg-black text-white" : "border-line bg-white text-muted"}`}>{label}</button>)}
        <select value={provider} onChange={e => setProvider(e.target.value)} className="focus-ring h-9 rounded-full border border-line bg-white px-3 text-sm"><option value="ALL">Todos os marketplaces</option><option value="SHOPEE">Shopee</option><option value="MERCADO_LIVRE">Mercado Livre</option></select></div>
      {upcoming.length ? <div className="flex flex-wrap items-center gap-2 text-sm">
        {day === today ? <button disabled={!!busy} onClick={startNow} className="inline-flex h-9 items-center gap-2 rounded-lg border border-line bg-white px-3 disabled:opacity-40"><Clock size={15}/> Começar agora</button> : null}
        <button disabled={!!busy} onClick={spreadDay} className="inline-flex h-9 items-center gap-2 rounded-lg border border-line bg-white px-3 disabled:opacity-40"><CalendarDays size={15}/> Espalhar 07h–22h</button>
        <span className="inline-flex items-center gap-2 rounded-lg border border-line bg-white px-2 py-1"><select value={spreadDays} onChange={e => setSpreadDays(Number(e.target.value))} className="h-7 bg-transparent">{[2, 3, 4, 5, 6, 7].map(n => <option key={n} value={n}>{n} dias</option>)}</select><label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={keepTimes} onChange={e => setKeepTimes(e.target.checked)}/> manter horários</label><button disabled={!!busy} onClick={redistribute} className="h-7 rounded-md bg-black px-3 text-xs font-medium text-white disabled:opacity-40">Redistribuir</button></span>
      </div> : null}
    </div>

    {notice ? <p className="rounded-lg bg-zinc-100 p-3 text-sm">{notice}</p> : null}
    {error ? <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p> : loading ? <div className="flex justify-center p-12"><Loader2 className="animate-spin text-muted"/></div>
      : !visible.length ? <div className="rounded-xl border border-dashed border-line bg-white p-12 text-center"><ShoppingBag className="mx-auto text-muted"/><h2 className="mt-3 font-semibold">Nenhuma oferta {filter === "all" ? "agendada" : "neste filtro"} para este dia.</h2><p className="mt-1 text-sm text-muted">Selecione produtos no Catálogo e use &ldquo;Agendar selecionados&rdquo;.</p></div>
      : <ol className="space-y-3">{visible.map(item => <AgendaRow key={item.id} item={item} busy={busy === item.id} disabled={!!busy} messageOpen={openMessage === item.id}
          onToggleMessage={() => setOpenMessage(openMessage === item.id ? null : item.id)}
          onTime={time => void apply(item.id, [{ id: item.id, scheduledAt: brasiliaInstant(brasiliaDate(new Date(item.scheduledAt)), time).toISOString() }])}
          onTomorrow={() => void apply(item.id, [{ id: item.id, scheduledAt: sameTimeTomorrow(new Date(item.scheduledAt)).toISOString() }])}
          onNow={() => void apply(item.id, [{ id: item.id, scheduledAt: new Date().toISOString() }])}
          onRemove={() => void remove(item)}/>)}</ol>}
  </div>;
}

function AgendaRow({ item, busy, disabled, messageOpen, onToggleMessage, onTime, onTomorrow, onNow, onRemove }: {
  item: Item; busy: boolean; disabled: boolean; messageOpen: boolean; onToggleMessage: () => void;
  onTime: (time: string) => void; onTomorrow: () => void; onNow: () => void; onRemove: () => void;
}) {
  const time = brasiliaTime(new Date(item.scheduledAt));
  const [draft, setDraft] = useState(time);
  useEffect(() => setDraft(time), [time]);
  const editable = item.status === "programado";
  const status = STATUS[item.status];
  return <li className="rounded-xl border border-line bg-white p-3 shadow-sm">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
      <div className="flex items-center gap-3 sm:w-40 sm:shrink-0">
        {editable ? <input type="time" value={draft} disabled={disabled} onChange={e => setDraft(e.target.value)} onBlur={() => draft && draft !== time && onTime(draft)} className="focus-ring h-10 w-28 rounded-lg border border-line px-2 text-lg font-semibold tabular-nums"/> : <span className="w-28 text-lg font-semibold tabular-nums">{time}</span>}
        {busy ? <Loader2 className="animate-spin text-muted" size={16}/> : null}
      </div>
      <div className="flex min-w-0 flex-1 items-center gap-3">
        {item.imageUrl ? <img src={item.imageUrl} alt="" className="h-14 w-14 shrink-0 rounded-lg border border-line object-contain"/> : <div className="grid h-14 w-14 shrink-0 place-items-center rounded-lg bg-wash"><ShoppingBag size={18} className="text-muted"/></div>}
        <div className="min-w-0">
          <p className="line-clamp-2 text-sm font-medium">{item.productName}</p>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted">
            <span className={`rounded-full px-2 py-0.5 font-bold ${item.provider === "MERCADO_LIVRE" ? "bg-[#ffe600] text-black" : "bg-[#ee4d2d] text-white"}`}>{item.provider === "MERCADO_LIVRE" ? "ML" : "SHOPEE"}</span>
            {item.originalPrice && item.price && item.originalPrice > item.price ? <span className="line-through">{money(item.originalPrice)}</span> : null}
            <strong className="text-ink">{money(item.price)}</strong>
            <span>· {item.groupCount} {item.groupCount === 1 ? "grupo" : "grupos"}</span>
            <span className={`rounded-full px-2 py-0.5 font-medium ${status.className}`}>{status.label}{item.status === "parcial" ? ` (${item.sent} ok, ${item.failed} erro)` : ""}</span>
          </p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2 sm:justify-end">
        <button onClick={onToggleMessage} className="inline-flex h-9 items-center gap-1 rounded-lg border border-line px-3 text-xs"><MessageSquareText size={14}/> Mensagem</button>
        {editable ? <>
          <button disabled={disabled} onClick={onTomorrow} className="h-9 rounded-lg border border-line px-3 text-xs disabled:opacity-40">Amanhã</button>
          <button disabled={disabled} onClick={onNow} className="inline-flex h-9 items-center gap-1 rounded-lg border border-line px-3 text-xs disabled:opacity-40"><Send size={14}/> Enviar agora</button>
          <button disabled={disabled} onClick={onRemove} className="inline-flex h-9 items-center gap-1 rounded-lg border border-red-200 px-3 text-xs text-red-700 disabled:opacity-40"><Trash2 size={14}/> Remover</button>
        </> : null}
      </div>
    </div>
    {messageOpen ? <pre className="mt-3 whitespace-pre-wrap rounded-lg bg-[#e9f7ee] p-4 font-sans text-sm leading-6">{item.message}</pre> : null}
  </li>;
}
