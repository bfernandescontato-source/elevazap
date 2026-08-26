import type { AutomationSchedule } from "./types.js";

type Parts = { year: number; month: number; day: number; hour: number; minute: number; second: number };

// A Pilot queue that is more than a week ahead is no longer operationally useful:
// it is normally a stale schedule left behind by a reset or an old configuration.
// Do not let it postpone every new offer indefinitely.
const MAX_QUEUE_AHEAD_MS = 7 * 24 * 60 * 60 * 1_000;

function zonedParts(date: Date, timezone: string): Parts {
  const values = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23"
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) => Number(values.find((item) => item.type === type)?.value);
  return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour"), minute: get("minute"), second: get("second") };
}

function localToUtc(parts: Parts, timezone: string) {
  let candidate = new Date(Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second));
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const actual = zonedParts(candidate, timezone);
    const wantedMs = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
    const actualMs = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute, actual.second);
    candidate = new Date(candidate.getTime() + wantedMs - actualMs);
  }
  return candidate;
}

function clock(value: string) {
  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 + minute;
}

function addLocalDays(parts: Parts, days: number): Parts {
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate(), hour: parts.hour, minute: parts.minute, second: 0 };
}

export function nextOfferSlot(schedule: AutomationSchedule, now: Date, lastScheduledAt?: Date | null) {
  const intervalMs = schedule.intervalMinutes * 60_000;
  const lastIsUsable = Boolean(lastScheduledAt && lastScheduledAt.getTime() <= now.getTime() + MAX_QUEUE_AHEAD_MS);
  const earliest = new Date(Math.max(now.getTime(), lastIsUsable && lastScheduledAt ? lastScheduledAt.getTime() + intervalMs : now.getTime()));
  const local = zonedParts(earliest, schedule.timezone);
  const currentMinute = local.hour * 60 + local.minute;
  const startMinute = clock(schedule.operatingStart);
  const endMinute = clock(schedule.operatingEnd);
  if (startMinute >= endMinute) throw new Error("A janela de funcionamento deve começar antes de terminar.");

  if (currentMinute < startMinute) {
    return localToUtc({ ...local, hour: Math.floor(startMinute / 60), minute: startMinute % 60, second: 0 }, schedule.timezone);
  }
  if (currentMinute > endMinute || (currentMinute === endMinute && local.second > 0)) {
    const tomorrow = addLocalDays(local, 1);
    return localToUtc({ ...tomorrow, hour: Math.floor(startMinute / 60), minute: startMinute % 60, second: 0 }, schedule.timezone);
  }
  return earliest;
}
