"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, CheckCircle2, ChevronLeft, ChevronRight, GripVertical, Loader2, X } from "lucide-react";

type Pasta = { id: string; nome: string };
type Modelo = { id: string; nome: string; tipo: string; pasta_id?: string | null; texto?: string | null; media_path?: string | null; created_at?: string | null };
type Campaign = { id: string; nome: string; whatsapp_sender_id?: string | null; grupos: { group_jid: string; nome?: string }[] };
type Sender = { id: string; label: string };
type ScheduleItem = { modelo: Modelo; scheduledAt: Date | null };

const INTERVALS = [
  { label: "5 minutos", value: 5 },
  { label: "10 minutos", value: 10 },
  { label: "15 minutos", value: 15 },
  { label: "20 minutos", value: 20 },
  { label: "30 minutos", value: 30 },
  { label: "45 minutos", value: 45 },
  { label: "1 hora", value: 60 },
  { label: "Personalizado", value: 0 }
];

function buildPreview(
  models: Modelo[],
  firstDate: string,
  firstTime: string,
  intervalMinutes: number,
  dailyLimit: boolean,
  limitTime: string,
  overflow: "next_day" | "allow" | "skip",
  restartTime: string
): ScheduleItem[] {
  if (!models.length || !firstDate || !firstTime || intervalMinutes < 1) return [];
  const firstAt = new Date(`${firstDate}T${firstTime}:00`);
  if (isNaN(firstAt.getTime())) return [];

  const results: ScheduleItem[] = [];
  let current = new Date(firstAt);

  for (const modelo of models) {
    if (dailyLimit) {
      const [lh, lm] = limitTime.split(":").map(Number);
      const [rh, rm] = restartTime.split(":").map(Number);
      const limitMins = lh * 60 + lm;
      const curMins = current.getHours() * 60 + current.getMinutes();

      if (curMins >= limitMins) {
        if (overflow === "next_day") {
          const next = new Date(current);
          next.setDate(next.getDate() + 1);
          next.setHours(rh, rm, 0, 0);
          current = next;
        } else if (overflow === "skip") {
          results.push({ modelo, scheduledAt: null });
          continue;
        }
      }
    }

    results.push({ modelo, scheduledAt: new Date(current) });
    current = new Date(current.getTime() + intervalMinutes * 60 * 1000);
  }

  return results;
}

function formatLocal(date: Date) {
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" }).format(date);
}

function formatDate(date: Date) {
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeZone: "America/Sao_Paulo" }).format(date);
}

function formatTime(date: Date) {
  return new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" }).format(date);
}

function tomorrowDate() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

interface Props {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export function BulkScheduleModal({ open, onClose, onSuccess }: Props) {
  const [step, setStep] = useState(1);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const [doneCount, setDoneCount] = useState(0);

  // Step 1 — Models
  const [pastas, setPastas] = useState<Pasta[]>([]);
  const [pastasLoaded, setPastasLoaded] = useState(false);
  const [pastaId, setPastaId] = useState("");
  const [allModelos, setAllModelos] = useState<Modelo[]>([]);
  const [modelosLoading, setModelosLoading] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [orderMode, setOrderMode] = useState<"pasta" | "antigas">("pasta");
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [manualOrder, setManualOrder] = useState<Modelo[]>([]);

  // Step 2 — Destination
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [campaignsLoaded, setCampaignsLoaded] = useState(false);
  const [campaignId, setCampaignId] = useState("");
  const [selectedJids, setSelectedJids] = useState<string[]>([]);
  const [senders, setSenders] = useState<Sender[]>([]);
  const [senderId, setSenderId] = useState("");

  // Step 3 — Schedule
  const [firstDate, setFirstDate] = useState(tomorrowDate);
  const [firstTime, setFirstTime] = useState("07:30");
  const [intervalSel, setIntervalSel] = useState(30);
  const [customInterval, setCustomInterval] = useState("60");
  const [dailyLimit, setDailyLimit] = useState(false);
  const [limitTime, setLimitTime] = useState("22:00");
  const [overflow, setOverflow] = useState<"next_day" | "allow" | "skip">("next_day");
  const [restartTime, setRestartTime] = useState("07:30");

  const intervalMinutes = intervalSel === 0 ? (parseInt(customInterval) || 30) : intervalSel;

  function reset() {
    setStep(1); setError(""); setDone(false); setDoneCount(0); setSaving(false);
    setPastaId(""); setAllModelos([]); setSelectedIds(new Set()); setManualOrder([]);
    setOrderMode("pasta"); setCampaignId(""); setSelectedJids([]); setSenderId("");
    setFirstDate(tomorrowDate()); setFirstTime("07:30"); setIntervalSel(30);
    setDailyLimit(false); setLimitTime("22:00"); setOverflow("next_day"); setRestartTime("07:30");
  }

  function handleClose() { reset(); onClose(); }

  // Load pastas on open
  useEffect(() => {
    if (!open || pastasLoaded) return;
    fetch("/api/modelos/pastas", { cache: "no-store" })
      .then((r) => r.json())
      .then((data) => { setPastas(Array.isArray(data) ? data : []); setPastasLoaded(true); })
      .catch(() => setPastasLoaded(true));
  }, [open, pastasLoaded]);

  // Load campaigns once (step 2)
  useEffect(() => {
    if (!open || campaignsLoaded) return;
    Promise.all([
      fetch("/api/campanhas", { cache: "no-store" }).then((r) => r.json()),
      fetch("/api/whatsapp/senders", { cache: "no-store" }).then((r) => r.json())
    ]).then(([camps, snd]) => {
      setCampaigns(Array.isArray(camps) ? camps : []);
      setSenders(Array.isArray(snd?.senders) ? snd.senders : []);
      setCampaignsLoaded(true);
    }).catch(() => setCampaignsLoaded(true));
  }, [open, campaignsLoaded]);

  // Load models when folder changes
  useEffect(() => {
    if (!pastaId) { setAllModelos([]); setSelectedIds(new Set()); setManualOrder([]); return; }
    setModelosLoading(true);
    fetch(`/api/modelos?pasta_id=${pastaId}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((data) => {
        const list: Modelo[] = Array.isArray(data) ? data : [];
        setAllModelos(list);
        setSelectedIds(new Set(list.map((m) => m.id)));
        setManualOrder(list);
      })
      .finally(() => setModelosLoading(false));
  }, [pastaId]);

  // Auto-select all groups when campaign changes
  useEffect(() => {
    const camp = campaigns.find((c) => c.id === campaignId);
    setSelectedJids(camp ? camp.grupos.map((g) => g.group_jid) : []);
  }, [campaignId, campaigns]);

  // displayList: order shown in step 1 list AND used for send order
  const displayList = useMemo(() => {
    if (orderMode === "antigas") return [...allModelos].sort((a, b) => (a.created_at || "").localeCompare(b.created_at || ""));
    return manualOrder;
  }, [allModelos, manualOrder, orderMode]);

  // orderedModelos: selected items in display order (same order sent to preview)
  const orderedModelos = useMemo(() => displayList.filter((m) => selectedIds.has(m.id)), [displayList, selectedIds]);

  // send position per model id (1-based, only for selected)
  const sendPositionMap = useMemo(() => {
    const map = new Map<string, number>();
    orderedModelos.forEach((m, i) => map.set(m.id, i + 1));
    return map;
  }, [orderedModelos]);

  function moveModelo(index: number, direction: number) {
    const next = [...manualOrder];
    const target = index + direction;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    setManualOrder(next);
  }

  const preview = useMemo(() =>
    buildPreview(orderedModelos, firstDate, firstTime, intervalMinutes, dailyLimit, limitTime, overflow, restartTime),
    [orderedModelos, firstDate, firstTime, intervalMinutes, dailyLimit, limitTime, overflow, restartTime]
  );

  const skipped = preview.filter((p) => p.scheduledAt === null).length;
  const scheduled = preview.filter((p) => p.scheduledAt !== null);

  const selectedCampaign = campaigns.find((c) => c.id === campaignId);

  // Step validation
  const step1Valid = orderedModelos.length > 0;
  const step2Valid = selectedJids.length > 0;
  const step3Valid = firstDate && firstTime && intervalMinutes >= 1;
  const step4Valid = scheduled.length > 0;

  async function confirm() {
    if (!step4Valid) return;
    setSaving(true);
    setError("");
    try {
      const body = {
        nome: `${selectedCampaign?.nome || "Campanha"} — ${new Date(`${firstDate}T${firstTime}`).toLocaleDateString("pt-BR")}`,
        campanha_id: campaignId || undefined,
        group_jids: selectedJids,
        whatsapp_sender_id: senderId || undefined,
        schedules: scheduled.map((p) => ({
          modelo_id: p.modelo.id,
          scheduled_at: p.scheduledAt!.toISOString()
        }))
      };
      const r = await fetch("/api/lotes/bulk-schedule", { method: "POST", body: JSON.stringify(body) });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "Falha ao criar agendamentos.");
      setDoneCount(data.total);
      setDone(true);
      onSuccess();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={handleClose}>
      <div className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between border-b border-line px-6 py-4">
          <div>
            <h2 className="font-semibold text-ink">Agendar em massa</h2>
            {!done && <p className="mt-0.5 text-xs text-muted">Passo {step} de 4</p>}
          </div>
          <button type="button" onClick={handleClose} className="grid h-8 w-8 place-items-center rounded-lg hover:bg-wash"><X size={16} /></button>
        </div>

        {/* Step indicators */}
        {!done && (
          <div className="flex border-b border-line px-6 py-3 gap-1">
            {["Modelos", "Destino", "Horários", "Revisar"].map((label, i) => (
              <div key={label} className="flex flex-1 items-center gap-1">
                <div className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${step === i + 1 ? "bg-ink text-white" : step > i + 1 ? "bg-emerald-500 text-white" : "bg-wash text-muted"}`}>
                  {step > i + 1 ? "✓" : i + 1}
                </div>
                <span className={`text-xs ${step === i + 1 ? "font-medium text-ink" : "text-muted"} hidden sm:block`}>{label}</span>
                {i < 3 && <div className="mx-1 flex-1 border-t border-line" />}
              </div>
            ))}
          </div>
        )}

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {done ? (
            <div className="flex flex-col items-center py-10 text-center">
              <CheckCircle2 size={48} className="text-emerald-500" />
              <h3 className="mt-4 text-lg font-semibold text-ink">{doneCount} agendamentos criados!</h3>
              <p className="mt-2 text-sm text-muted">Os disparos entrarão na fila automaticamente nos horários programados.</p>
              <button type="button" onClick={handleClose} className="mt-6 rounded-lg bg-black px-6 py-2.5 text-sm font-medium text-white hover:bg-zinc-800">Fechar</button>
            </div>
          ) : step === 1 ? (
            <div className="space-y-5">
              <div>
                <label className="block text-sm font-medium text-ink">Pasta de modelos</label>
                <select value={pastaId} onChange={(e) => setPastaId(e.target.value)} className="focus-ring mt-1 h-10 w-full rounded-lg border border-line bg-white px-3 text-sm">
                  <option value="">Selecione uma pasta…</option>
                  {pastas.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
                </select>
              </div>

              {pastaId && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-ink">Ordem dos envios</label>
                    <div className="mt-2 flex gap-4">
                      {[{ value: "pasta", label: "Ordem da pasta" }, { value: "antigas", label: "Mais antigas primeiro" }].map((opt) => (
                        <label key={opt.value} className="flex cursor-pointer items-center gap-2 text-sm">
                          <input type="radio" checked={orderMode === opt.value} onChange={() => setOrderMode(opt.value as "pasta" | "antigas")} />
                          {opt.label}
                        </label>
                      ))}
                    </div>
                  </div>

                  {modelosLoading ? (
                    <div className="flex items-center gap-2 text-sm text-muted"><Loader2 size={14} className="animate-spin" /> Carregando modelos…</div>
                  ) : allModelos.length === 0 ? (
                    <p className="text-sm text-muted">Nenhum modelo nesta pasta.</p>
                  ) : (
                    <div>
                      <div className="mb-2 flex items-center justify-between">
                        <label className="text-sm font-medium text-ink">Modelos ({orderedModelos.length} selecionados)</label>
                        <button type="button" onClick={() => setSelectedIds(selectedIds.size === allModelos.length ? new Set() : new Set(allModelos.map((m) => m.id)))} className="text-xs text-accent underline">
                          {selectedIds.size === allModelos.length ? "Desmarcar todos" : "Selecionar todos"}
                        </button>
                      </div>
                      <div className="max-h-64 space-y-1 overflow-y-auto rounded-lg border border-line p-2">
                        {displayList.map((m, index) => {
                          const pos = sendPositionMap.get(m.id);
                          return (
                            <div key={m.id} className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-wash">
                              <span className="w-6 shrink-0 text-right text-xs font-medium text-muted">{pos ?? "—"}</span>
                              <input type="checkbox" checked={selectedIds.has(m.id)} onChange={(e) => {
                                const next = new Set(selectedIds);
                                e.target.checked ? next.add(m.id) : next.delete(m.id);
                                setSelectedIds(next);
                              }} className="shrink-0" />
                              <span className="flex-1 truncate text-sm text-ink">{m.nome}</span>
                              <span className="shrink-0 rounded bg-wash px-1.5 py-0.5 text-xs text-muted">{m.tipo}</span>
                              {orderMode === "pasta" && (
                                <div className="flex shrink-0 gap-0.5">
                                  <button type="button" disabled={index === 0} onClick={() => moveModelo(index, -1)} className="grid h-6 w-6 place-items-center rounded text-muted disabled:opacity-30 hover:bg-line"><ArrowUp size={12} /></button>
                                  <button type="button" disabled={index === manualOrder.length - 1} onClick={() => moveModelo(index, 1)} className="grid h-6 w-6 place-items-center rounded text-muted disabled:opacity-30 hover:bg-line"><ArrowDown size={12} /></button>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          ) : step === 2 ? (
            <div className="space-y-5">
              <div>
                <label className="block text-sm font-medium text-ink">Campanha</label>
                <select value={campaignId} onChange={(e) => setCampaignId(e.target.value)} className="focus-ring mt-1 h-10 w-full rounded-lg border border-line bg-white px-3 text-sm">
                  <option value="">Selecione uma campanha…</option>
                  {campaigns.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
                </select>
              </div>

              {campaignId && selectedCampaign && (
                <div>
                  <div className="mb-2 flex items-center justify-between">
                    <label className="text-sm font-medium text-ink">Grupos ({selectedJids.length}/{selectedCampaign.grupos.length})</label>
                    <button type="button" onClick={() => setSelectedJids(selectedJids.length === selectedCampaign.grupos.length ? [] : selectedCampaign.grupos.map((g) => g.group_jid))} className="text-xs text-accent underline">
                      {selectedJids.length === selectedCampaign.grupos.length ? "Desmarcar todos" : "Selecionar todos"}
                    </button>
                  </div>
                  <div className="max-h-48 space-y-1 overflow-y-auto rounded-lg border border-line p-2">
                    {selectedCampaign.grupos.map((g) => (
                      <label key={g.group_jid} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-wash">
                        <input type="checkbox" checked={selectedJids.includes(g.group_jid)} onChange={(e) => setSelectedJids(e.target.checked ? [...selectedJids, g.group_jid] : selectedJids.filter((j) => j !== g.group_jid))} />
                        <span className="text-sm text-ink">{g.nome || g.group_jid}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-ink">Número de envio</label>
                <select value={senderId} onChange={(e) => setSenderId(e.target.value)} className="focus-ring mt-1 h-10 w-full rounded-lg border border-line bg-white px-3 text-sm">
                  <option value="">Número principal</option>
                  {senders.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                </select>
              </div>
            </div>
          ) : step === 3 ? (
            <div className="space-y-5">
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="block text-sm font-medium text-ink">Data do primeiro envio</label>
                  <input type="date" value={firstDate} min={new Date().toISOString().slice(0, 10)} onChange={(e) => setFirstDate(e.target.value)} className="focus-ring mt-1 h-10 w-full rounded-lg border border-line px-3 text-sm" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-ink">Horário do primeiro envio</label>
                  <input type="time" value={firstTime} onChange={(e) => setFirstTime(e.target.value)} className="focus-ring mt-1 h-10 w-full rounded-lg border border-line px-3 text-sm" />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-ink">Intervalo entre mensagens</label>
                <select value={intervalSel} onChange={(e) => setIntervalSel(Number(e.target.value))} className="focus-ring mt-1 h-10 w-full rounded-lg border border-line bg-white px-3 text-sm">
                  {INTERVALS.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                </select>
                {intervalSel === 0 && (
                  <div className="mt-2 flex items-center gap-2">
                    <input type="number" min="1" max="1440" value={customInterval} onChange={(e) => setCustomInterval(e.target.value)} className="focus-ring h-10 w-28 rounded-lg border border-line px-3 text-sm" placeholder="minutos" />
                    <span className="text-sm text-muted">minutos</span>
                  </div>
                )}
              </div>

              <div className="rounded-xl border border-line p-4">
                <label className="flex cursor-pointer items-center gap-3">
                  <input type="checkbox" checked={dailyLimit} onChange={(e) => setDailyLimit(e.target.checked)} />
                  <div>
                    <div className="text-sm font-medium text-ink">Limite de horário diário</div>
                    <div className="text-xs text-muted">Parar os envios depois de um horário definido</div>
                  </div>
                </label>

                {dailyLimit && (
                  <div className="mt-4 space-y-4">
                    <div>
                      <label className="block text-xs font-medium text-muted">Encerrar envios às</label>
                      <input type="time" value={limitTime} onChange={(e) => setLimitTime(e.target.value)} className="focus-ring mt-1 h-10 w-40 rounded-lg border border-line px-3 text-sm" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-muted">Se ultrapassar o limite</label>
                      <div className="mt-2 space-y-2">
                        {[
                          { value: "next_day", label: "Continuar no dia seguinte", desc: "Retoma no horário inicial do próximo dia" },
                          { value: "allow", label: "Agendar mesmo depois do limite", desc: "Ignora o limite e continua na sequência" },
                          { value: "skip", label: "Não agendar o excedente", desc: "Mensagens além do limite são ignoradas" }
                        ].map((opt) => (
                          <label key={opt.value} className="flex cursor-pointer items-start gap-2">
                            <input type="radio" checked={overflow === opt.value} onChange={() => setOverflow(opt.value as "next_day" | "allow" | "skip")} className="mt-0.5" />
                            <div>
                              <div className="text-sm text-ink">{opt.label}</div>
                              <div className="text-xs text-muted">{opt.desc}</div>
                            </div>
                          </label>
                        ))}
                      </div>
                    </div>
                    {overflow === "next_day" && (
                      <div>
                        <label className="block text-xs font-medium text-muted">Retomar no dia seguinte às</label>
                        <input type="time" value={restartTime} onChange={(e) => setRestartTime(e.target.value)} className="focus-ring mt-1 h-10 w-40 rounded-lg border border-line px-3 text-sm" />
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          ) : (
            // Step 4 — Preview
            <div className="space-y-4">
              <div className="rounded-xl border border-line bg-wash px-4 py-3 text-sm">
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  <div><span className="text-muted">Pasta:</span> <span className="font-medium text-ink">{pastas.find((p) => p.id === pastaId)?.nome}</span></div>
                  <div><span className="text-muted">Campanha:</span> <span className="font-medium text-ink">{selectedCampaign?.nome || "—"}</span></div>
                  <div><span className="text-muted">Grupos:</span> <span className="font-medium text-ink">{selectedJids.length}</span></div>
                  <div><span className="text-muted">Início:</span> <span className="font-medium text-ink">{firstDate ? new Date(`${firstDate}T${firstTime}`).toLocaleString("pt-BR") : "—"}</span></div>
                  <div><span className="text-muted">Intervalo:</span> <span className="font-medium text-ink">{intervalMinutes} min</span></div>
                  <div><span className="text-muted">Agendamentos:</span> <span className="font-medium text-emerald-600">{scheduled.length}</span>{skipped > 0 && <span className="ml-1 text-amber-600">({skipped} ignorados)</span>}</div>
                </div>
              </div>

              {skipped > 0 && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                  {skipped} mensagem(ns) serão ignoradas por ultrapassarem o limite de horário.
                </div>
              )}

              {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

              <div className="overflow-hidden rounded-xl border border-line">
                <div className="grid grid-cols-[2rem_1fr_6rem_4.5rem] gap-x-3 border-b border-line bg-wash px-4 py-2.5 text-xs font-medium uppercase text-muted">
                  <div>#</div><div>Mensagem</div><div>Data</div><div>Horário</div>
                </div>
                <div className="max-h-72 divide-y divide-line overflow-y-auto">
                  {preview.map((item, i) => (
                    <div key={item.modelo.id} className={`grid grid-cols-[2rem_1fr_6rem_4.5rem] items-center gap-x-3 px-4 py-2.5 text-sm ${item.scheduledAt === null ? "bg-amber-50 opacity-60" : ""}`}>
                      <div className="text-muted">{i + 1}</div>
                      <div className="truncate font-medium text-ink">{item.modelo.nome}</div>
                      <div className="text-muted">{item.scheduledAt ? formatDate(item.scheduledAt) : "—"}</div>
                      <div className="font-medium text-ink">{item.scheduledAt ? formatTime(item.scheduledAt) : "Ignorado"}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        {!done && (
          <div className="flex items-center justify-between border-t border-line px-6 py-4">
            <button type="button" onClick={() => step === 1 ? handleClose() : setStep((s) => (s - 1) as 1 | 2 | 3 | 4)} className="inline-flex h-10 items-center gap-2 rounded-lg border border-line px-4 text-sm font-medium hover:bg-wash">
              <ChevronLeft size={15} />{step === 1 ? "Cancelar" : "Voltar"}
            </button>

            {step < 4 ? (
              <button
                type="button"
                disabled={step === 1 ? !step1Valid : step === 2 ? !step2Valid : !step3Valid}
                onClick={() => setStep((s) => (s + 1) as 1 | 2 | 3 | 4)}
                className="inline-flex h-10 items-center gap-2 rounded-lg bg-black px-5 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-40"
              >
                Próximo <ChevronRight size={15} />
              </button>
            ) : (
              <button
                type="button"
                disabled={!step4Valid || saving}
                onClick={confirm}
                className="inline-flex h-10 items-center gap-2 rounded-lg bg-black px-5 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-40"
              >
                {saving ? <><Loader2 size={15} className="animate-spin" /> Criando…</> : `Confirmar ${scheduled.length} agendamentos`}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
