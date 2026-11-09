// Mensagens automáticas: cálculo das ocorrências diárias no fuso de São Paulo.
// Funções puras. O banco (materialize_recurring_group_message) faz o mesmo
// cálculo para criar os lotes de verdade; aqui serve para a prévia "Próximos
// envios" e para validar o que o aluno salva. As duas regras precisam bater:
// hoje e amanhã, dias ISO (1 = segunda, 7 = domingo), horário já passado ou a
// menos de 1 minuto não conta, e a chave (mensagem, data local, horário local).

import { localDateTimeToIso } from "@/lib/timezone";

export const MAX_RECURRING_MESSAGES = 5;
export const MAX_TIMES_PER_DAY = 5;
export const MAX_GROUPS = 500;
export const MIN_LEAD_MS = 60_000;
export const TIME_ZONE = "America/Sao_Paulo";

export const GROUP_LINK_PLACEHOLDER = "{link_do_grupo}";
export const GROUP_LINK_SAMPLE = "https://chat.whatsapp.com/SeuGrupo";

export const INVITE_TEMPLATE = [
  "Chame seus amigos para o grupo! 🎁",
  "Quanto mais gente aqui, mais descontos a gente libera para todos.",
  "",
  // Link e chamada na mesma linha: sem link, a linha inteira sai e o resto faz sentido.
  `Mande para quem gosta de economizar: ${GROUP_LINK_PLACEHOLDER}`
].join("\n");

export const WEEKDAYS: Array<{ value: number; short: string; label: string }> = [
  { value: 1, short: "Seg", label: "Segunda" },
  { value: 2, short: "Ter", label: "Terça" },
  { value: 3, short: "Qua", label: "Quarta" },
  { value: 4, short: "Qui", label: "Quinta" },
  { value: 5, short: "Sex", label: "Sexta" },
  { value: 6, short: "Sáb", label: "Sábado" },
  { value: 7, short: "Dom", label: "Domingo" }
];

export type RecurringSchedule = { times: string[]; weekdays: number[]; active?: boolean };
export type Occurrence = { localDate: string; localTime: string; scheduledAt: string; key: string };

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function isValidTime(value: string) {
  return TIME_RE.test(value);
}

/** Horários válidos, sem repetição e em ordem ("HH:MM"). */
export function normalizeTimes(times: string[]) {
  return Array.from(new Set(times.map((time) => time.trim().slice(0, 5)).filter(isValidTime))).sort();
}

export function normalizeWeekdays(days: number[]) {
  return Array.from(new Set(days.filter((day) => Number.isInteger(day) && day >= 1 && day <= 7))).sort((a, b) => a - b);
}

/** "2026-11-06" no fuso de São Paulo. */
export function localDate(at: Date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
}

export function addLocalDays(day: string, days: number) {
  const [year, month, date] = day.split("-").map(Number);
  const value = new Date(Date.UTC(year, month - 1, date + days, 12));
  return value.toISOString().slice(0, 10);
}

/** Dia da semana ISO (1 = segunda, 7 = domingo) de uma data local "AAAA-MM-DD". */
export function isoWeekday(day: string) {
  const [year, month, date] = day.split("-").map(Number);
  const weekday = new Date(Date.UTC(year, month - 1, date, 12)).getUTCDay();
  return weekday === 0 ? 7 : weekday;
}

/** Chave de idempotência: igual à chave única do banco. */
export function occurrenceKey(messageId: string, day: string, time: string) {
  return `${messageId}:${day}:${time.slice(0, 5)}`;
}

/**
 * Ocorrências de hoje em diante por `days` dias (padrão: hoje e amanhã, como o
 * banco materializa). Mensagem desligada não tem ocorrência.
 */
export function upcomingOccurrences(messageId: string, schedule: RecurringSchedule, now: Date = new Date(), days = 2): Occurrence[] {
  if (schedule.active === false) return [];
  const times = normalizeTimes(schedule.times);
  const weekdays = new Set(normalizeWeekdays(schedule.weekdays));
  const today = localDate(now);
  const result: Occurrence[] = [];
  for (let offset = 0; offset < days; offset += 1) {
    const day = addLocalDays(today, offset);
    if (!weekdays.has(isoWeekday(day))) continue;
    for (const time of times) {
      const iso = localDateTimeToIso(day, time, TIME_ZONE);
      if (!iso || new Date(iso).getTime() <= now.getTime() + MIN_LEAD_MS) continue;
      result.push({ localDate: day, localTime: time, scheduledAt: iso, key: occurrenceKey(messageId, day, time) });
    }
  }
  return result;
}

/** Próximo envio dentro de uma semana, para mostrar na lista. */
export function nextOccurrence(messageId: string, schedule: RecurringSchedule, now: Date = new Date()) {
  return upcomingOccurrences(messageId, schedule, now, 8)[0] || null;
}

/** Prévia no editor: o link de cada grupo entra no lugar da variável. */
export function previewWithGroupLink(text: string, link: string = GROUP_LINK_SAMPLE) {
  return text.split(GROUP_LINK_PLACEHOLDER).join(link);
}

/** Texto que sobra sem a variável do link (a mensagem não pode ser só o link). */
export function textWithoutPlaceholder(text: string) {
  return text.split(GROUP_LINK_PLACEHOLDER).join("").trim();
}
