"use client";

import { ActionButton, ConfirmModal, EmptyState, ErrorState, LoadingState, Toast } from "@/components/ui";
import { CalendarClock, ImagePlus, Link2, Pencil, Plus, Power, Sparkles, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  GROUP_LINK_PLACEHOLDER, INVITE_TEMPLATE, MAX_RECURRING_MESSAGES, MAX_TIMES_PER_DAY, WEEKDAYS,
  isValidTime, nextOccurrence, normalizeTimes, previewWithGroupLink, textWithoutPlaceholder
} from "@/modules/recurring-messages/schedule";

type Media = { bucket: string; storage_path: string; file_name: string; mime_type: string; file_size_bytes: number };
type Message = {
  id: string; nome: string; tipo: "texto" | "imagem"; texto: string; media: Media | null;
  whatsapp_sender_id: string | null; group_jids: string[]; horarios: string[]; dias_semana: number[];
  ativo: boolean; last_error: string | null;
};
type Run = { messageId: string; localDate: string; localTime: string; scheduledAt: string; status: string | null; total: number; sent: number; failed: number };
type Sender = { id: string; label: string; session_name: string; status?: string };
type Group = { group_jid: string; nome?: string };
type Draft = Omit<Message, "id" | "last_error"> & { id?: string };

const EVERY_DAY = [1, 2, 3, 4, 5, 6, 7];
const WORK_DAYS = [1, 2, 3, 4, 5];

const emptyDraft = (senderId = ""): Draft => ({
  nome: "", tipo: "texto", texto: "", media: null, whatsapp_sender_id: senderId, group_jids: [],
  horarios: ["09:00"], dias_semana: EVERY_DAY, ativo: true
});

function daysLabel(days: number[]) {
  const sorted = [...days].sort((a, b) => a - b).join(",");
  if (sorted === EVERY_DAY.join(",")) return "Todos os dias";
  if (sorted === WORK_DAYS.join(",")) return "Segunda a sexta";
  return WEEKDAYS.filter((day) => days.includes(day.value)).map((day) => day.short).join(", ");
}

function whenLabel(iso: string) {
  return new Intl.DateTimeFormat("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" }).format(new Date(iso));
}

function runStatusLabel(run: Run) {
  if (run.status === "sucesso") return "Enviado";
  if (run.status === "erro") return run.sent > 0 ? "Parcial" : "Com erro";
  if (run.status === "processando") return "Enviando";
  if (run.status === "cancelado") return "Cancelado";
  if (run.status === "pausado") return "Pausado";
  if (run.status === "incerto") return "Conferir";
  return new Date(run.scheduledAt).getTime() > Date.now() ? "Programado" : "Na fila";
}

async function readJson(response: Response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Algo deu errado. Tente de novo.");
  return data;
}

export function RecurringMessages() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [senders, setSenders] = useState<Sender[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [removing, setRemoving] = useState<Message | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [data, senderData] = await Promise.all([
        fetch("/api/mensagens-automaticas", { cache: "no-store" }).then(readJson),
        fetch("/api/whatsapp/senders", { cache: "no-store" }).then(readJson).catch(() => ({ senders: [] }))
      ]);
      setMessages(data.messages || []); setRuns(data.runs || []); setSenders(senderData.senders || []); setError("");
    } catch (loadError: any) { setError(loadError.message); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(""), 4000); return () => clearTimeout(timer); }, [toast]);

  async function toggle(message: Message) {
    setBusy(true);
    try {
      await readJson(await fetch(`/api/mensagens-automaticas/${message.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ ativo: !message.ativo }) }));
      setToast(message.ativo ? "Mensagem desligada. Os próximos envios foram cancelados." : "Mensagem ligada.");
      await load();
    } catch (toggleError: any) { setToast(toggleError.message); }
    finally { setBusy(false); }
  }

  async function remove() {
    if (!removing) return;
    setBusy(true);
    try {
      await readJson(await fetch(`/api/mensagens-automaticas/${removing.id}`, { method: "DELETE" }));
      setRemoving(null); setToast("Mensagem apagada."); await load();
    } catch (removeError: any) { setToast(removeError.message); }
    finally { setBusy(false); }
  }

  const senderName = (id: string | null) => senders.find((sender) => sender.id === id)?.label || "Número removido";
  const full = messages.length >= MAX_RECURRING_MESSAGES;

  if (loading) return <LoadingState />;
  return <div className="space-y-5">
    <div className="flex flex-col gap-3 rounded-lg border border-line bg-panel p-5 shadow-soft sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <h2 className="font-semibold text-ink">Mensagens que se repetem todo dia</h2>
        <p className="mt-1 text-sm text-muted">Avisos, regras e convite do grupo. Até {MAX_RECURRING_MESSAGES} mensagens, cada uma com até {MAX_TIMES_PER_DAY} horários por dia.</p>
      </div>
      <ActionButton icon={<Plus size={16} />} disabled={full} onClick={() => setDraft(emptyDraft(senders[0]?.id || ""))}>Nova mensagem</ActionButton>
    </div>
    {full ? <p className="text-sm text-muted">Você chegou ao limite de {MAX_RECURRING_MESSAGES} mensagens. Apague uma para criar outra.</p> : null}
    {error ? <ErrorState message={error} /> : null}
    {!error && !messages.length ? <EmptyState title="Nenhuma mensagem automática" description="Crie uma mensagem e escolha os horários. Ela sai sozinha todo dia." /> : null}

    <div className="grid gap-4 lg:grid-cols-2">
      {messages.map((message) => {
        const next = nextOccurrence(message.id, { times: message.horarios, weekdays: message.dias_semana, active: message.ativo });
        const messageRuns = runs.filter((run) => run.messageId === message.id).slice(0, 4);
        return <article key={message.id} className="min-w-0 rounded-lg border border-line bg-panel p-5 shadow-soft">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="truncate font-semibold text-ink">{message.nome}</h3>
              <p className="mt-1 text-xs text-muted">{senderName(message.whatsapp_sender_id)} · {message.group_jids.length} grupo(s) · {daysLabel(message.dias_semana)}</p>
            </div>
            <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${message.ativo ? "bg-emerald-100 text-emerald-800" : "bg-wash text-muted"}`}>{message.ativo ? "Ligada" : "Desligada"}</span>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">{message.horarios.map((time) => <span key={time} className="rounded-full border border-line bg-wash px-3 py-1 font-mono text-xs text-ink">{time}</span>)}</div>
          <p className="mt-3 line-clamp-3 whitespace-pre-wrap break-words text-sm text-muted">{message.texto || (message.tipo === "imagem" ? "Só a imagem." : "")}</p>
          {message.last_error ? <p className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">{message.last_error}</p> : null}
          <div className="mt-3 text-sm text-ink"><CalendarClock size={14} className="mr-1 inline" />{next ? `Próximo envio: ${whenLabel(next.scheduledAt)}` : "Sem próximo envio."}</div>
          {messageRuns.length ? <ul className="mt-2 space-y-1 text-xs text-muted">{messageRuns.map((run) => <li key={`${run.localDate}-${run.localTime}`} className="flex justify-between gap-2"><span>{whenLabel(run.scheduledAt)}</span><span>{runStatusLabel(run)}</span></li>)}</ul> : null}
          <div className="mt-4 grid grid-cols-3 gap-2">
            <button type="button" className="touch-target inline-flex items-center justify-center gap-1 rounded-lg border border-line px-3 py-2 text-sm" onClick={() => setDraft({ ...message })}><Pencil size={15} /> Editar</button>
            <button type="button" disabled={busy} className="touch-target inline-flex items-center justify-center gap-1 rounded-lg border border-line px-3 py-2 text-sm disabled:opacity-50" onClick={() => toggle(message)}><Power size={15} /> {message.ativo ? "Desligar" : "Ligar"}</button>
            <button type="button" disabled={busy} className="touch-target inline-flex items-center justify-center gap-1 rounded-lg border border-red-200 px-3 py-2 text-sm text-red-700 disabled:opacity-50" onClick={() => setRemoving(message)}><Trash2 size={15} /> Apagar</button>
          </div>
        </article>;
      })}
    </div>

    {draft ? <RecurringMessageEditor draft={draft} senders={senders} onClose={() => setDraft(null)} onSaved={async (text) => { setDraft(null); setToast(text); await load(); }} /> : null}
    <ConfirmModal open={Boolean(removing)} title="Apagar mensagem automática?" destructive loading={busy} confirmLabel="Apagar" onCancel={() => setRemoving(null)} onConfirm={remove}>
      Os próximos envios que ainda não saíram serão cancelados.
    </ConfirmModal>
    <Toast message={toast} />
  </div>;
}

function RecurringMessageEditor({ draft: initial, senders, onClose, onSaved }: { draft: Draft; senders: Sender[]; onClose: () => void; onSaved: (toast: string) => Promise<void> }) {
  const [draft, setDraft] = useState<Draft>(initial);
  const [groups, setGroups] = useState<Group[]>([]);
  const [query, setQuery] = useState("");
  const [newTime, setNewTime] = useState("12:00");
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const textRef = useRef<HTMLTextAreaElement>(null);
  const update = (patch: Partial<Draft>) => setDraft((current) => ({ ...current, ...patch }));

  useEffect(() => {
    if (!draft.whatsapp_sender_id) { setGroups([]); return; }
    let alive = true;
    fetch(`/api/whatsapp/groups?sender_id=${draft.whatsapp_sender_id}`, { cache: "no-store" }).then((r) => r.json())
      .then((body) => { if (alive) setGroups(Array.isArray(body) ? body : []); })
      .catch(() => { if (alive) setGroups([]); });
    return () => { alive = false; };
  }, [draft.whatsapp_sender_id]);

  const filtered = useMemo(() => groups.filter((group) => `${group.nome || ""} ${group.group_jid}`.toLowerCase().includes(query.toLowerCase())), [groups, query]);
  const preview = previewWithGroupLink(draft.texto);
  const usesLink = draft.texto.includes(GROUP_LINK_PLACEHOLDER);

  function insertAtCursor(value: string) {
    const element = textRef.current;
    const start = element?.selectionStart ?? draft.texto.length;
    const end = element?.selectionEnd ?? draft.texto.length;
    const next = `${draft.texto.slice(0, start)}${value}${draft.texto.slice(end)}`;
    update({ texto: next });
    requestAnimationFrame(() => { element?.focus(); element?.setSelectionRange(start + value.length, start + value.length); });
  }

  function addTime() {
    if (!isValidTime(newTime)) return setError("Horário inválido.");
    if (draft.horarios.length >= MAX_TIMES_PER_DAY) return setError(`Use até ${MAX_TIMES_PER_DAY} horários por dia.`);
    setError(""); update({ horarios: normalizeTimes([...draft.horarios, newTime]) });
  }

  function toggleDay(day: number) {
    update({ dias_semana: draft.dias_semana.includes(day) ? draft.dias_semana.filter((item) => item !== day) : [...draft.dias_semana, day].sort() });
  }

  function toggleGroup(jid: string) {
    update({ group_jids: draft.group_jids.includes(jid) ? draft.group_jids.filter((item) => item !== jid) : [...draft.group_jids, jid] });
  }

  async function uploadImage(image: File): Promise<Media> {
    const signed = await fetch("/api/upload/signed-url", { method: "POST", body: JSON.stringify({ tipo: "imagem", file_name: image.name, mime_type: image.type, file_size_bytes: image.size }) }).then(readJson);
    const put = await fetch(signed.signedUrl, { method: "PUT", headers: { "content-type": image.type }, body: image });
    if (!put.ok) throw new Error("Não foi possível enviar a imagem.");
    await fetch("/api/upload/confirm", { method: "POST", body: JSON.stringify({ storage_path: signed.storage_path }) }).then(readJson);
    return { bucket: signed.bucket, storage_path: signed.storage_path, file_name: image.name, mime_type: image.type, file_size_bytes: image.size };
  }

  async function save() {
    setError("");
    if (!draft.nome.trim()) return setError("Dê um nome para a mensagem.");
    if (!draft.whatsapp_sender_id) return setError("Escolha o número que vai enviar.");
    if (!draft.group_jids.length) return setError("Escolha ao menos um grupo.");
    if (!draft.horarios.length) return setError("Adicione ao menos um horário.");
    if (!draft.dias_semana.length) return setError("Escolha ao menos um dia da semana.");
    if (draft.tipo === "texto" && !textWithoutPlaceholder(draft.texto)) return setError("Escreva o texto da mensagem.");
    if (draft.tipo === "imagem" && !file && !draft.media) return setError("Escolha a imagem.");
    setSaving(true);
    try {
      const media = draft.tipo === "imagem" ? (file ? await uploadImage(file) : draft.media) : null;
      const body = { nome: draft.nome, tipo: draft.tipo, texto: draft.texto, media, whatsapp_sender_id: draft.whatsapp_sender_id, group_jids: draft.group_jids, horarios: draft.horarios, dias_semana: draft.dias_semana, ativo: draft.ativo };
      const data = await readJson(await fetch(draft.id ? `/api/mensagens-automaticas/${draft.id}` : "/api/mensagens-automaticas", { method: draft.id ? "PATCH" : "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));
      const scheduled = Number(data.scheduled || 0);
      await onSaved(draft.ativo ? (scheduled ? `Mensagem salva. ${scheduled} envio(s) programado(s) para hoje e amanhã.` : "Mensagem salva. Os envios entram na fila no dia certo.") : "Mensagem salva e desligada.");
    } catch (saveError: any) { setError(saveError.message); }
    finally { setSaving(false); }
  }

  const chip = (on: boolean) => `touch-target rounded-full border px-3 py-1.5 text-sm ${on ? "border-primary bg-primary text-white" : "border-line bg-panel text-ink"}`;

  return <div className="fixed inset-0 z-50 flex items-end bg-overlay/45 sm:grid sm:place-items-center sm:p-4" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) onClose(); }}>
    <div role="dialog" aria-modal="true" aria-label={draft.id ? "Editar mensagem automática" : "Nova mensagem automática"} className="app-safe-bottom max-h-[92dvh] w-full overflow-y-auto rounded-t-2xl bg-panel p-5 shadow-soft sm:max-w-2xl sm:rounded-xl">
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-semibold text-ink">{draft.id ? "Editar mensagem automática" : "Nova mensagem automática"}</h3>
        <button type="button" aria-label="Fechar" className="touch-target grid place-items-center rounded-lg text-muted" onClick={onClose} disabled={saving}><X size={18} /></button>
      </div>

      <div className="mt-4 space-y-5">
        <label className="block text-sm font-medium text-ink">Nome
          <input value={draft.nome} maxLength={80} onChange={(event) => update({ nome: event.target.value })} placeholder="Ex.: Regras do grupo" className="focus-ring mt-2 h-11 w-full rounded-lg border border-line bg-panel px-3 text-sm font-normal" />
        </label>

        <div>
          <div className="text-sm font-medium text-ink">Tipo</div>
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" className={chip(draft.tipo === "texto")} onClick={() => update({ tipo: "texto" })}>Só texto</button>
            <button type="button" className={chip(draft.tipo === "imagem")} onClick={() => update({ tipo: "imagem" })}>Texto e imagem</button>
          </div>
          {draft.tipo === "imagem" ? <label className="mt-3 flex cursor-pointer items-center gap-3 rounded-lg border border-dashed border-line bg-wash p-4 text-sm">
            <ImagePlus size={18} className="text-muted" />
            <span className="min-w-0 truncate">{file?.name || draft.media?.file_name || "Escolher imagem (JPG, PNG ou WEBP)"}</span>
            <input className="sr-only" type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => setFile(event.target.files?.[0] || null)} />
          </label> : null}
        </div>

        <div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <label htmlFor="recurring-text" className="text-sm font-medium text-ink">{draft.tipo === "imagem" ? "Legenda" : "Texto"}</label>
            <div className="flex flex-wrap gap-2">
              <button type="button" className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-line px-3 text-xs" onClick={() => insertAtCursor(GROUP_LINK_PLACEHOLDER)}><Link2 size={14} /> Link do grupo</button>
              <button type="button" className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-line px-3 text-xs" onClick={() => update({ texto: INVITE_TEMPLATE, nome: draft.nome || "Convite do grupo" })}><Sparkles size={14} /> Convite do grupo</button>
            </div>
          </div>
          <textarea id="recurring-text" ref={textRef} value={draft.texto} maxLength={4096} rows={6} onChange={(event) => update({ texto: event.target.value })} className="focus-ring mt-2 w-full rounded-lg border border-line bg-panel p-3 text-sm" />
          <p className="mt-1 text-xs text-muted">Use {GROUP_LINK_PLACEHOLDER} para colocar o link atual de cada grupo. O número precisa ser admin do grupo. Sem o link, essa linha sai da mensagem.</p>
          {usesLink || draft.texto ? <div className="mt-3 rounded-lg bg-wash p-3"><div className="text-xs font-medium uppercase text-muted">Prévia</div><div className="mt-1 whitespace-pre-wrap break-words text-sm text-ink">{preview}</div></div> : null}
        </div>

        <label className="block text-sm font-medium text-ink">Número que envia
          <select value={draft.whatsapp_sender_id || ""} onChange={(event) => update({ whatsapp_sender_id: event.target.value, group_jids: [] })} className="focus-ring mt-2 h-11 w-full rounded-lg border border-line bg-panel px-3 text-sm font-normal">
            <option value="">Escolha um número</option>
            {senders.map((sender) => <option key={sender.id} value={sender.id}>{sender.label}</option>)}
          </select>
        </label>

        <div>
          <div className="flex items-center justify-between"><span className="text-sm font-medium text-ink">Grupos</span><span className="text-xs text-muted">{draft.group_jids.length} escolhido(s)</span></div>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar grupo" aria-label="Buscar grupo" className="focus-ring mt-2 h-11 w-full rounded-lg border border-line bg-panel px-3 text-sm" />
          <div className="mt-2 max-h-56 overflow-y-auto rounded-lg border border-line">
            {groups.length ? <label className="flex cursor-pointer items-center gap-3 border-b border-line bg-wash p-3 text-sm font-medium"><input type="checkbox" checked={filtered.length > 0 && filtered.every((group) => draft.group_jids.includes(group.group_jid))} onChange={(event) => update({ group_jids: event.target.checked ? Array.from(new Set([...draft.group_jids, ...filtered.map((group) => group.group_jid)])) : draft.group_jids.filter((jid) => !filtered.some((group) => group.group_jid === jid)) })} /> Marcar todos da busca</label> : null}
            {filtered.map((group) => <label key={group.group_jid} className="flex cursor-pointer items-center gap-3 border-b border-line p-3 text-sm last:border-0"><input type="checkbox" checked={draft.group_jids.includes(group.group_jid)} onChange={() => toggleGroup(group.group_jid)} /><span className="truncate">{group.nome || group.group_jid}</span></label>)}
            {!groups.length ? <p className="p-4 text-sm text-muted">{draft.whatsapp_sender_id ? "Este número ainda não tem grupos. Atualize os grupos em Números." : "Escolha um número para ver os grupos."}</p> : null}
          </div>
        </div>

        <div>
          <div className="text-sm font-medium text-ink">Horários (até {MAX_TIMES_PER_DAY} por dia)</div>
          <div className="mt-2 flex flex-wrap gap-2">
            {draft.horarios.map((time) => <span key={time} className="inline-flex items-center gap-1 rounded-full border border-line bg-wash py-1 pl-3 pr-1 font-mono text-sm">{time}<button type="button" aria-label={`Tirar ${time}`} className="grid h-7 w-7 place-items-center rounded-full text-muted hover:bg-panel" onClick={() => update({ horarios: draft.horarios.filter((item) => item !== time) })}><X size={14} /></button></span>)}
          </div>
          <div className="mt-2 flex gap-2">
            <input type="time" value={newTime} onChange={(event) => setNewTime(event.target.value)} aria-label="Novo horário" className="focus-ring h-11 rounded-lg border border-line bg-panel px-3 text-sm" />
            <button type="button" disabled={draft.horarios.length >= MAX_TIMES_PER_DAY} className="touch-target rounded-lg border border-line px-4 text-sm disabled:opacity-50" onClick={addTime}>Adicionar</button>
          </div>
          <p className="mt-1 text-xs text-muted">Horário de Brasília.</p>
        </div>

        <div>
          <div className="text-sm font-medium text-ink">Dias da semana</div>
          <div className="mt-2 flex flex-wrap gap-2">
            {WEEKDAYS.map((day) => <button key={day.value} type="button" aria-label={day.label} aria-pressed={draft.dias_semana.includes(day.value)} className={chip(draft.dias_semana.includes(day.value))} onClick={() => toggleDay(day.value)}>{day.short}</button>)}
          </div>
          <div className="mt-2 flex flex-wrap gap-3 text-xs">
            <button type="button" className="text-primary underline" onClick={() => update({ dias_semana: EVERY_DAY })}>Todos os dias</button>
            <button type="button" className="text-primary underline" onClick={() => update({ dias_semana: WORK_DAYS })}>Segunda a sexta</button>
          </div>
        </div>

        <label className="flex items-center gap-3 text-sm text-ink"><input type="checkbox" checked={draft.ativo} onChange={(event) => update({ ativo: event.target.checked })} className="h-4 w-4" /> Mensagem ligada</label>

        {error ? <ErrorState message={error} /> : null}
        <div className="grid grid-cols-2 gap-2 sm:flex sm:justify-end">
          <button type="button" disabled={saving} className="touch-target rounded-lg border border-line px-4 py-2 text-sm disabled:opacity-50" onClick={onClose}>Voltar</button>
          <ActionButton disabled={saving} onClick={save}>{saving ? "Salvando..." : "Salvar"}</ActionButton>
        </div>
      </div>
    </div>
  </div>;
}
