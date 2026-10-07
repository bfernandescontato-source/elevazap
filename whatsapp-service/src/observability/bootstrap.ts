import { mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "crypto";
import { supabase } from "../supabase.js";
import { dbResult } from "../utils/db.js";
import { env } from "../env.js";
import { observer, parseSessionList, PROCESS_SESSION, type IncidentRow, type MinuteRow, type ObsConfig, type ObsPersistence } from "./observer.js";
import { sampleEventLoop, startEventLoopMonitor, stopEventLoopMonitor } from "./supervisor-trace.js";

const UPSERT_CHUNK = 500;
const CLEANUP_INTERVAL_MS = 60 * 60_000;
const CRASH_FILE_PREFIX = "disparei-obs-crash-";
const CRASH_FILES_KEPT = 3;
const CRASH_UPLOADS_PER_HOUR = 3;
const CRASH_UPLOAD_DELAY_MS = 90_000; // depois do boot das sessões, para não disputar o banco
const CRASH_UPLOAD_LOG = "disparei-obs-crash-uploads.json";

/** Grava em lote: uma chamada por OBS_FLUSH_MS para todos os números. */
export const supabaseObsPersistence: ObsPersistence = {
  async writeMinutes(rows: MinuteRow[]) {
    for (let i = 0; i < rows.length; i += UPSERT_CHUNK) {
      await dbResult("obs.minutes.upsert", supabase.from("whatsapp_obs_minutes").upsert(rows.slice(i, i + UPSERT_CHUNK), { onConflict: "session_name,minute" }));
    }
  },
  async writeIncident(row) {
    await dbResult("obs.incident.insert", supabase.from("whatsapp_obs_incidents").insert(row));
  },
  async resolveIncident(incidentId, resolvedAt, silenceMs) {
    await dbResult("obs.incident.resolve", supabase.from("whatsapp_obs_incidents")
      .update({ resolved_at: resolvedAt, silence_ms: silenceMs }).eq("incident_id", incidentId).is("resolved_at", null));
  }
};

async function cleanupOldRows() {
  const day = 24 * 60 * 60_000;
  const minutesBefore = new Date(Date.now() - env.OBS_RETENTION_DAYS * day).toISOString();
  const incidentsBefore = new Date(Date.now() - env.OBS_INCIDENT_RETENTION_DAYS * day).toISOString();
  await dbResult("obs.minutes.cleanup", supabase.from("whatsapp_obs_minutes").delete().lt("minute", minutesBefore));
  await dbResult("obs.incidents.cleanup", supabase.from("whatsapp_obs_incidents").delete().lt("detected_at", incidentsBefore));
}

// ---- gravação na queda ------------------------------------------------------

function crashFiles() {
  try {
    return readdirSync(env.OBS_CRASH_DIR).filter((name) => name.startsWith(CRASH_FILE_PREFIX) && name.endsWith(".json")).sort();
  } catch {
    return [];
  }
}

/**
 * Roda no `uncaughtExceptionMonitor`, antes de o processo morrer: escrita
 * síncrona dos últimos minutos de cada número ativo. Não muda o tratamento da
 * exceção (o processo continua caindo como antes).
 */
export function writeCrashDump(origin: string, error: unknown) {
  try {
    mkdirSync(env.OBS_CRASH_DIR, { recursive: true });
    const file = join(env.OBS_CRASH_DIR, `${CRASH_FILE_PREFIX}${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
    const dump = { origin, error: String((error as any)?.stack || (error as any)?.message || error).slice(0, 4000), ...observer.crashDump() };
    writeFileSync(file, JSON.stringify(dump));
    const files = crashFiles();
    for (const old of files.slice(0, Math.max(0, files.length - CRASH_FILES_KEPT))) {
      try { unlinkSync(join(env.OBS_CRASH_DIR, old)); } catch { /* nada */ }
    }
  } catch {
    // nunca esconder a queda original
  }
}

const onCrash = (error: Error, origin: string) => writeCrashDump(origin, error);

function recentCrashUploads(now: number) {
  try {
    const list = JSON.parse(readFileSync(join(env.OBS_CRASH_DIR, CRASH_UPLOAD_LOG), "utf8")) as number[];
    return list.filter((at) => now - at < 60 * 60_000);
  } catch {
    return [] as number[];
  }
}

/** No boot seguinte, envia a gravação da queda ao banco (no máx. 3 por hora, 1 linha por queda). */
export async function uploadCrashDumps() {
  const files = crashFiles();
  if (!files.length) return 0;
  const now = Date.now();
  const uploads = recentCrashUploads(now);
  let sent = 0;
  for (const name of files) {
    const path = join(env.OBS_CRASH_DIR, name);
    if (uploads.length >= CRASH_UPLOADS_PER_HOUR) {
      console.warn({ event: "obs.crash_upload_skipped", component: "obs", file: name, reason: "hour_cap" });
      break;
    }
    try {
      const dump = JSON.parse(readFileSync(path, "utf8"));
      const row: IncidentRow = {
        id: randomUUID(),
        incident_id: randomUUID(),
        session_name: PROCESS_SESSION,
        account_id: null,
        kind: "crash",
        reason: String(dump.origin || "uncaughtException"),
        level_minutes: 0,
        classification: "PROCESS_CRASH",
        detected_at: String(dump.dumped_at || new Date(now).toISOString()),
        snapshot: dump
      };
      await supabaseObsPersistence.writeIncident(row);
      renameSync(path, `${path}.uploaded`);
      uploads.push(now);
      sent += 1;
      console.info({ event: "obs.crash_uploaded", component: "obs", file: name, sessions: Array.isArray(dump.sessions) ? dump.sessions.length : 0 });
    } catch (error: any) {
      console.error({ event: "obs.crash_upload_failed", component: "obs", file: name, error: String(error?.message || error) });
    }
  }
  try { writeFileSync(join(env.OBS_CRASH_DIR, CRASH_UPLOAD_LOG), JSON.stringify(uploads)); } catch { /* nada */ }
  return sent;
}

// ---- liga/desliga ---------------------------------------------------------------

let timers: NodeJS.Timeout[] = [];
let crashMonitorInstalled = false;

function startRuntimeHooks() {
  if (!timers.length) {
    timers = [
      setInterval(() => { try { observer.tick(); } catch (error) { console.error({ event: "obs.tick_failed", error: String(error) }); } }, env.OBS_DETECT_MS),
      setInterval(() => { try { sampleEventLoop(); } catch (error) { console.error({ event: "obs.eventloop_failed", error: String(error) }); } }, 60_000),
      setInterval(() => void observer.flush(), env.OBS_FLUSH_MS),
      setInterval(() => { if (env.OBS_PERSIST) void cleanupOldRows().catch((error) => console.error({ event: "obs.cleanup_failed", error: String(error?.message || error) })); }, CLEANUP_INTERVAL_MS)
    ];
    for (const timer of timers) timer.unref?.();
  }
  startEventLoopMonitor();
  if (!crashMonitorInstalled) {
    process.on("uncaughtExceptionMonitor", onCrash);
    crashMonitorInstalled = true;
  }
}

function stopRuntimeHooks() {
  for (const timer of timers) clearInterval(timer);
  timers = [];
  stopEventLoopMonitor();
  if (crashMonitorInstalled) {
    process.off("uncaughtExceptionMonitor", onCrash);
    crashMonitorInstalled = false;
  }
}

function applyConfig(config: ObsConfig) {
  if (config.enabled) {
    startRuntimeHooks();
  } else {
    // Grava o que já está fechado antes de parar; nada novo é contado.
    void observer.flush();
    stopRuntimeHooks();
  }
}

/** Ganchos de processo registrados agora (para conferir que desligado = zero). */
export function runtimeHookState() {
  return { timers: timers.length, crash_monitor: crashMonitorInstalled, process_crash_listeners: process.listenerCount("uncaughtExceptionMonitor") };
}

let started = false;

export function startObservability() {
  if (started) return;
  started = true;
  if (env.OBS_PERSIST) observer.setPersistence(supabaseObsPersistence);
  observer.onConfigChange(applyConfig);
  const config = observer.configure({ enabled: env.OBS_ENABLED, sessions: parseSessionList(env.OBS_SESSIONS) });
  console.info({ event: "obs.started", component: "obs", ...config, persist: env.OBS_PERSIST, flush_ms: env.OBS_FLUSH_MS, detect_ms: env.OBS_DETECT_MS, ring_minutes: env.OBS_RING_MINUTES, retention_days: env.OBS_RETENTION_DAYS });
  if (config.enabled && env.OBS_PERSIST) {
    setTimeout(() => void uploadCrashDumps().catch(() => undefined), CRASH_UPLOAD_DELAY_MS).unref?.();
  }
}
