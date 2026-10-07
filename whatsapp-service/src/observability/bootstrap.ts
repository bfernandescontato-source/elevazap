import { supabase } from "../supabase.js";
import { dbResult } from "../utils/db.js";
import { env } from "../env.js";
import { observer, type ObsPersistence, type MinuteRow } from "./observer.js";
import { sampleEventLoop, startEventLoopMonitor } from "./supervisor-trace.js";

const UPSERT_CHUNK = 500;
const CLEANUP_INTERVAL_MS = 60 * 60_000;

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

async function cleanupOldMinutes() {
  const before = new Date(Date.now() - env.OBS_RETENTION_DAYS * 24 * 60 * 60_000).toISOString();
  await dbResult("obs.minutes.cleanup", supabase.from("whatsapp_obs_minutes").delete().lt("minute", before));
}

let started = false;

export function startObservability() {
  if (started || !env.OBS_ENABLED) return;
  started = true;
  if (env.OBS_PERSIST) observer.setPersistence(supabaseObsPersistence);
  startEventLoopMonitor();
  const timers = [
    setInterval(() => { try { observer.tick(); } catch (error) { console.error({ event: "obs.tick_failed", error: String(error) }); } }, env.OBS_DETECT_MS),
    setInterval(() => { try { sampleEventLoop(); } catch (error) { console.error({ event: "obs.eventloop_failed", error: String(error) }); } }, 60_000),
    setInterval(() => void observer.flush(), env.OBS_FLUSH_MS),
    setInterval(() => { if (env.OBS_PERSIST) void cleanupOldMinutes().catch((error) => console.error({ event: "obs.cleanup_failed", error: String(error?.message || error) })); }, CLEANUP_INTERVAL_MS)
  ];
  for (const timer of timers) timer.unref?.();
  console.info({ event: "obs.started", component: "obs", persist: env.OBS_PERSIST, flush_ms: env.OBS_FLUSH_MS, detect_ms: env.OBS_DETECT_MS, ring_minutes: env.OBS_RING_MINUTES });
}
