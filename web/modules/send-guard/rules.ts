// Regras de envio da conta: pausa noturna e produto repetido. Funções puras, iguais
// às do banco (supabase/migrations/20261106120000_send_rules_quiet_hours_and_repeat.sql):
// o painel usa para mostrar o horário certo e o banco garante a regra na fila.
import { z } from "zod";
import { localDateTimeToIso } from "@/lib/timezone";

export const SEND_RULES_TIMEZONE = "America/Sao_Paulo";
export const SUGGESTED_QUIET_START = "22:00";
export const SUGGESTED_QUIET_END = "06:00";
export const SUGGESTED_REPEAT_DAYS = 3;
export const MAX_REPEAT_DAYS = 30;

export type SendRules = {
  quietHoursEnabled: boolean;
  quietStart: string;
  quietEnd: string;
  productRepeatDays: number;
};

export const DEFAULT_SEND_RULES: SendRules = {
  quietHoursEnabled: false,
  quietStart: SUGGESTED_QUIET_START,
  quietEnd: SUGGESTED_QUIET_END,
  productRepeatDays: 0
};

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use o formato 22:00.");
export const sendRulesSchema = z.object({
  quietHoursEnabled: z.boolean(),
  quietStart: time,
  quietEnd: time,
  productRepeatDays: z.number().int().min(0, "Use 0 ou mais dias.").max(MAX_REPEAT_DAYS, `Use no máximo ${MAX_REPEAT_DAYS} dias.`)
}).refine((rules) => rules.quietStart !== rules.quietEnd, { message: "O início e o fim da pausa precisam ser diferentes.", path: ["quietEnd"] });

const minutes = (value: string) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5));

function localParts(at: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: SEND_RULES_TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23"
  }).formatToParts(at);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value || "00";
  return { day: `${get("year")}-${get("month")}-${get("day")}`, minuteOfDay: Number(get("hour")) * 60 + Number(get("minute")) };
}

function nextDay(day: string) {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, date + 1)).toISOString().slice(0, 10);
}

function instant(day: string, hhmm: string) {
  const iso = localDateTimeToIso(day, hhmm, SEND_RULES_TIMEZONE);
  return iso ? new Date(iso) : null;
}

/** Fim da pausa quando `at` cai dentro dela; senão o próprio `at`. Início entra, fim não. */
export function shiftOutOfQuietHours(at: Date, rules: Pick<SendRules, "quietHoursEnabled" | "quietStart" | "quietEnd">): Date {
  if (!rules.quietHoursEnabled || rules.quietStart === rules.quietEnd) return at;
  const start = minutes(rules.quietStart);
  const end = minutes(rules.quietEnd);
  const { day, minuteOfDay } = localParts(at);
  let target: Date | null = null;
  if (start < end) {
    if (minuteOfDay >= start && minuteOfDay < end) target = instant(day, rules.quietEnd);
  } else if (minuteOfDay >= start) {
    target = instant(nextDay(day), rules.quietEnd);
  } else if (minuteOfDay < end) {
    target = instant(day, rules.quietEnd);
  }
  return target && target > at ? target : at;
}

export function isInQuietHours(at: Date, rules: Pick<SendRules, "quietHoursEnabled" | "quietStart" | "quietEnd">) {
  return shiftOutOfQuietHours(at, rules).getTime() !== at.getTime();
}

/** Mesmo formato do banco: "SHOPEE:123". Sem marketplace ou código, não há regra. */
export function productKey(provider?: string | null, itemId?: string | null): string | null {
  const p = (provider || "").trim();
  const id = (itemId || "").trim();
  if (!p || !id || p.toLowerCase() === "multiple") return null;
  return `${p.toUpperCase()}:${id.toUpperCase()}`;
}

/** Status que contam como "o grupo recebeu ou vai receber". Erro e cancelado não contam. */
export const REPEAT_ACTIVE_STATUSES = ["pendente", "enfileirado", "processando", "sucesso", "incerto", "pausado"] as const;

export type RepeatHistoryRow = { group_jid: string; product_key: string | null; status: string | null; scheduled_at: string | null };

/** Grupos que já têm o produto a menos de `days` dias de `at` (antes ou depois). */
export function repeatedGroups(history: RepeatHistoryRow[], key: string | null, groupJids: string[], at: Date, days: number): Set<string> {
  const blocked = new Set<string>();
  if (!key || days <= 0) return blocked;
  const windowMs = days * 86_400_000;
  const wanted = new Set(groupJids);
  for (const row of history) {
    if (row.product_key !== key || !wanted.has(row.group_jid) || !row.scheduled_at) continue;
    if (!(REPEAT_ACTIVE_STATUSES as readonly string[]).includes(row.status || "")) continue;
    if (Math.abs(new Date(row.scheduled_at).getTime() - at.getTime()) < windowMs) blocked.add(row.group_jid);
  }
  return blocked;
}

export function repeatWindow(at: Date, days: number) {
  return { from: new Date(at.getTime() - days * 86_400_000).toISOString(), to: new Date(at.getTime() + days * 86_400_000).toISOString() };
}

export function daysLabel(days: number) {
  return days === 1 ? "1 dia" : `${days} dias`;
}
