// Horários da Agenda do Catálogo, sempre no fuso de Brasília (sem horário de verão
// desde 2019, então o deslocamento é fixo em -03:00). Funções puras: o navegador
// usa para a prévia e o servidor não precisa recalcular.

export const DAY_START = "07:00";
export const DAY_END = "22:00";
const MINUTE = 60_000;
const BRASILIA_OFFSET = "-03:00";

/** "2026-09-25" no fuso de Brasília. */
export function brasiliaDate(at: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
}

export function addDays(day: string, days: number): string {
  const date = new Date(`${day}T12:00:00${BRASILIA_OFFSET}`);
  date.setUTCDate(date.getUTCDate() + days);
  return brasiliaDate(date);
}

/** Instante de um dia e horário ("HH:MM") de Brasília. */
export function brasiliaInstant(day: string, time: string): Date {
  return new Date(`${day}T${time}:00${BRASILIA_OFFSET}`);
}

/** "14:30" no fuso de Brasília. */
export function brasiliaTime(at: Date): string {
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" }).format(at);
}

function floorToMinute(at: Date) {
  return new Date(Math.floor(at.getTime() / MINUTE) * MINUTE);
}

/** Início da janela do dia: 07h, ou 5 minutos a partir de agora se o dia for hoje. */
export function windowStart(day: string, now: Date = new Date()): Date {
  const start = brasiliaInstant(day, DAY_START);
  const soon = new Date(Math.ceil((now.getTime() + 5 * MINUTE) / MINUTE) * MINUTE);
  return soon > start ? soon : start;
}

/**
 * Espalha `count` ofertas entre 07h e 22h do dia (como o Motor Mercado): a janela é
 * dividida em count+1 partes, então 4 ofertas num dia inteiro saem perto de 10h,
 * 13h, 16h e 19h. Para hoje, a janela começa em "agora + 5 min".
 * Devolve null quando não sobra janela (hoje depois das 22h).
 */
export function spreadInDay(count: number, day: string, now: Date = new Date()): Date[] | null {
  if (count < 1) return [];
  const start = windowStart(day, now);
  const end = brasiliaInstant(day, DAY_END);
  if (start >= end) return null;
  const step = (end.getTime() - start.getTime()) / (count + 1);
  return Array.from({ length: count }, (_, index) => floorToMinute(new Date(start.getTime() + step * (index + 1))));
}

/**
 * A partir de um horário fixo, uma oferta a cada `intervalMinutes`. Horário que
 * já passou começa em "agora + 5 min".
 */
export function everyInterval(count: number, day: string, firstTime: string, intervalMinutes: number, now: Date = new Date()): Date[] {
  if (count < 1 || intervalMinutes < 1) return [];
  const requested = brasiliaInstant(day, firstTime);
  const soon = new Date(Math.ceil((now.getTime() + 5 * MINUTE) / MINUTE) * MINUTE);
  const first = requested > soon ? requested : soon;
  return Array.from({ length: count }, (_, index) => new Date(first.getTime() + index * intervalMinutes * MINUTE));
}

/**
 * Divide as ofertas em `days` dias seguidos a partir de `firstDay`, mantendo a
 * ordem (as primeiras no primeiro dia), e espalha cada dia entre 07h e 22h.
 * Devolve null se o primeiro dia não tiver mais janela.
 */
export function spreadAcrossDays(count: number, firstDay: string, days: number, now: Date = new Date()): Date[] | null {
  if (count < 1) return [];
  const totalDays = Math.max(1, Math.min(days, count));
  const base = Math.floor(count / totalDays);
  const extra = count % totalDays;
  const result: Date[] = [];
  for (let index = 0; index < totalDays; index++) {
    const slots = spreadInDay(base + (index < extra ? 1 : 0), addDays(firstDay, index), now);
    if (!slots) return null;
    result.push(...slots);
  }
  return result;
}

/** Mesmo horário, no dia seguinte. */
export function sameTimeTomorrow(at: Date): Date {
  return new Date(at.getTime() + 24 * 60 * MINUTE);
}
