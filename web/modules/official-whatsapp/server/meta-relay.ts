import { createHash } from "node:crypto";
import { env } from "@/lib/env";
import { supabaseAdmin } from "@/lib/supabase";

type MetaChange = { value?: { metadata?: { phone_number_id?: unknown }; messages?: unknown[]; statuses?: unknown[] } };
type MetaEntry = { changes?: MetaChange[]; [key: string]: unknown };
type MetaPayload = { entry?: MetaEntry[]; [key: string]: unknown };

type RelayConfig = { phoneNumberId: string; url: string; token: string };
type RelayJob = { id: string; idempotency_key: string; payload: MetaPayload; attempts: number; max_attempts: number };

const retryDelaysSeconds = [30, 120, 600, 1800];

function config(): RelayConfig | null {
  const values = env();
  if (values.META_RELAY_ENABLED !== "true") return null;
  if (!values.META_RELAY_PHONE_NUMBER_ID || !values.META_RELAY_URL || !values.META_RELAY_TOKEN) {
    console.error("[meta-relay] Relay habilitado, mas a configuração está incompleta.");
    return null;
  }
  return { phoneNumberId: values.META_RELAY_PHONE_NUMBER_ID, url: values.META_RELAY_URL, token: values.META_RELAY_TOKEN };
}

export function filterMetaPayloadForPhoneNumber(payload: MetaPayload, phoneNumberId: string): MetaPayload | null {
  const entries = (Array.isArray(payload?.entry) ? payload.entry : []).flatMap((entry) => {
    const changes = (Array.isArray(entry?.changes) ? entry.changes : []).filter((change) => change?.value?.metadata?.phone_number_id === phoneNumberId);
    return changes.length ? [{ ...entry, changes }] : [];
  });
  return entries.length ? { ...payload, entry: entries } : null;
}

function relayEventDetails(payload: MetaPayload) {
  const eventTypes = new Set<string>();
  const eventIds = new Set<string>();
  for (const entry of Array.isArray(payload.entry) ? payload.entry : []) {
    for (const change of Array.isArray(entry.changes) ? entry.changes : []) {
      const value = change?.value;
      for (const message of Array.isArray(value?.messages) ? value.messages : []) {
        eventTypes.add("messages");
        if (typeof (message as any)?.id === "string") eventIds.add((message as any).id);
      }
      for (const status of Array.isArray(value?.statuses) ? value.statuses : []) {
        eventTypes.add(`status:${typeof (status as any)?.status === "string" ? (status as any).status : "unknown"}`);
        if (typeof (status as any)?.id === "string") eventIds.add(`${(status as any).id}:${String((status as any)?.status || "unknown")}:${String((status as any)?.timestamp || "")}`);
      }
    }
  }
  return { eventTypes: [...eventTypes], eventIds: [...eventIds] };
}

export function metaRelayIdempotencyKey(payload: MetaPayload, phoneNumberId: string) {
  return createHash("sha256").update(`${phoneNumberId}:${JSON.stringify(payload)}`).digest("hex");
}

export function metaRelayRetryDelaySeconds(attempt: number) {
  return retryDelaysSeconds[Math.max(0, attempt - 1)] || retryDelaysSeconds.at(-1)!;
}

export function shouldRetryMetaRelay(status: number | null) {
  return status === null || status === 408 || status === 425 || status === 429 || status >= 500;
}

export async function enqueueMetaRelay(payload: MetaPayload, authorizedPhoneNumberIds?: ReadonlySet<string>) {
  const relay = config();
  if (!relay) return { queued: false, reason: "disabled" as const };
  if (authorizedPhoneNumberIds && !authorizedPhoneNumberIds.has(relay.phoneNumberId)) return { queued: false, reason: "unrecognized_phone" as const };
  const filtered = filterMetaPayloadForPhoneNumber(payload, relay.phoneNumberId);
  if (!filtered) return { queued: false, reason: "other_phone" as const };
  const idempotencyKey = metaRelayIdempotencyKey(filtered, relay.phoneNumberId);
  const details = relayEventDetails(filtered);
  const { error } = await supabaseAdmin().from("meta_relay_jobs").insert({
    idempotency_key: idempotencyKey,
    phone_number_id: relay.phoneNumberId,
    event_types: details.eventTypes,
    event_ids: details.eventIds,
    payload: filtered
  });
  if (error && error.code !== "23505") throw error;
  return { queued: !error, reason: error ? "duplicate" as const : "queued" as const };
}

async function finishJob(job: RelayJob, result: { status: "delivered" | "retry_scheduled" | "failed"; httpStatus: number | null; error: string | null; durationMs: number; nextAttemptAt?: string }) {
  const values: Record<string, unknown> = {
    status: result.status,
    attempts: job.attempts + 1,
    last_http_status: result.httpStatus,
    last_error: result.error,
    last_duration_ms: result.durationMs,
    claimed_at: null,
    updated_at: new Date().toISOString()
  };
  if (result.status === "delivered") values.delivered_at = new Date().toISOString();
  if (result.nextAttemptAt) values.next_attempt_at = result.nextAttemptAt;
  const { error } = await supabaseAdmin().from("meta_relay_jobs").update(values).eq("id", job.id);
  if (error) throw error;
}

async function deliverJob(job: RelayJob, relay: RelayConfig) {
  const startedAt = Date.now();
  let httpStatus: number | null = null;
  let errorMessage: string | null = null;
  try {
    const response = await fetch(relay.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-disparei-relay-token": relay.token,
        "x-disparei-relay-idempotency-key": job.idempotency_key
      },
      body: JSON.stringify(job.payload),
      signal: AbortSignal.timeout(10_000)
    });
    httpStatus = response.status;
    if (response.ok) {
      await finishJob(job, { status: "delivered", httpStatus, error: null, durationMs: Date.now() - startedAt });
      return;
    }
    errorMessage = `CRM respondeu HTTP ${response.status}.`;
  } catch (error) {
    errorMessage = error instanceof Error ? error.message.slice(0, 500) : "Falha de conexão com o CRM.";
  }

  const attempt = job.attempts + 1;
  const retry = attempt < job.max_attempts && shouldRetryMetaRelay(httpStatus);
  const delaySeconds = metaRelayRetryDelaySeconds(attempt);
  await finishJob(job, {
    status: retry ? "retry_scheduled" : "failed",
    httpStatus,
    error: errorMessage,
    durationMs: Date.now() - startedAt,
    nextAttemptAt: retry ? new Date(Date.now() + delaySeconds * 1000).toISOString() : undefined
  });
}

// Executado pelo Cron da Vercel. A tabela faz o claim atômico e conserva o histórico de
// tentativa, para que nenhuma indisponibilidade do CRM bloqueie o webhook da Meta.
export async function runDueMetaRelayJobs() {
  const relay = config();
  if (!relay) return { processed: 0, disabled: true };
  const admin = supabaseAdmin();
  const { data: claimed, error } = await admin.rpc("claim_due_meta_relay_jobs", { p_limit: 20, p_stale_seconds: 120 });
  if (error) throw error;
  const ids = (claimed || []).map((row: { id: string }) => row.id);
  if (!ids.length) return { processed: 0, disabled: false };
  const { data: jobs, error: jobsError } = await admin.from("meta_relay_jobs").select("id,idempotency_key,payload,attempts,max_attempts").in("id", ids);
  if (jobsError) throw jobsError;
  await Promise.all((jobs || []).map((job) => deliverJob(job as RelayJob, relay).catch((error) => console.error(`[meta-relay] Falha ao finalizar job ${job.id}:`, error))));
  return { processed: jobs?.length || 0, disabled: false };
}
