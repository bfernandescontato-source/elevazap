import { batchKeyStore } from "./batched-key-store.js";
import { initAuthCreds, makeCacheableSignalKeyStore, proto, type AuthenticationCreds, type SignalDataSet } from "@whiskeysockets/baileys";
import { BufferJSON } from "@whiskeysockets/baileys";
import { supabase } from "../supabase.js";
import { dbResult } from "../utils/db.js";
import { observer } from "../observability/observer.js";
import { env } from "../env.js";
import { trimSessionRecord } from "./signal-session-retention.js";
import { AuthKeysUnavailableError, KEY_READ_POLICY, isTemporaryKeyReadError, keyOutageCooldown, keyReadRetryDelay } from "./key-read-guard.js";

function serialize(data: unknown) {
  return JSON.parse(JSON.stringify(data, BufferJSON.replacer));
}

function deserialize<T>(data: unknown): T {
  return JSON.parse(JSON.stringify(data), BufferJSON.reviver);
}

// Registro de sessões Signal com mais de 40 sessões: aplica a retenção da libsignal
// (ver signal-session-retention.ts). Loga quanto saiu para dar para medir.
function retainSessions(sessionName: string, type: string, _id: string, value: any, where: "read" | "write") {
  if (type !== "session" || !env.SIGNAL_SESSION_RETENTION || value == null) return value;
  const { data, removed } = trimSessionRecord(value);
  if (removed) console.warn({ event: "auth.signal_sessions_trimmed", component: "auth", session_name: sessionName, where, removed, kept: Object.keys((data as any)._sessions || {}).length });
  return data;
}

// Signal ratchets are read-modify-write state. Keep auth operations ordered so
// an older concurrent write cannot replace a newer cryptographic state.
const authOperationTails = new Map<string, Promise<void>>();

// Observabilidade: profundidade da fila por número e idade da operação mais
// antiga (enfileirada ou em execução). Só mede; não muda a ordem.
let authOperationSeq = 0;
const authQueues = new Map<string, { depth: number; enqueuedAt: Map<number, number> }>();

export function authQueueStats(sessionName: string) {
  const queue = authQueues.get(sessionName);
  if (!queue || !queue.depth) return { depth: 0, oldest_age_ms: null as number | null };
  let oldest = Infinity;
  for (const at of queue.enqueuedAt.values()) oldest = Math.min(oldest, at);
  return { depth: queue.depth, oldest_age_ms: Date.now() - oldest };
}

function safeObserve(action: () => void) {
  try { action(); } catch { /* observabilidade nunca interfere na chave */ }
}

async function withAuthOperationLock<T>(lockKey: string, operation: () => Promise<T>, sessionName?: string): Promise<T> {
  const previous = authOperationTails.get(lockKey) || Promise.resolve();
  let releaseCurrent!: () => void;
  const current = new Promise<void>((resolve) => { releaseCurrent = resolve; });
  const tail = previous.catch(() => undefined).then(() => current);
  authOperationTails.set(lockKey, tail);
  // Decidido na entrada: se a observação mudar no meio, a saída continua coerente.
  const tracked = Boolean(sessionName && observer.isActive(sessionName));
  const opId = tracked ? ++authOperationSeq : 0;
  const enqueuedAt = tracked ? Date.now() : 0;
  if (tracked && sessionName) safeObserve(() => {
    const queue = authQueues.get(sessionName) || { depth: 0, enqueuedAt: new Map<number, number>() };
    queue.depth += 1;
    queue.enqueuedAt.set(opId, enqueuedAt);
    authQueues.set(sessionName, queue);
    observer.max(sessionName, "auth_depth", queue.depth);
  });
  await previous.catch(() => undefined);
  if (tracked && sessionName) safeObserve(() => observer.max(sessionName, "auth_wait_ms", Date.now() - enqueuedAt));
  try {
    return await operation();
  } finally {
    releaseCurrent();
    if (authOperationTails.get(lockKey) === tail) authOperationTails.delete(lockKey);
    if (tracked && sessionName) safeObserve(() => {
      const queue = authQueues.get(sessionName);
      if (queue) { queue.depth = Math.max(0, queue.depth - 1); queue.enqueuedAt.delete(opId); }
    });
  }
}

/** Mede uma leitura/gravação de chave Signal sem alterar seu resultado. */
async function measureKeyOperation<T>(sessionName: string, kind: "signal_read" | "signal_write", keys: number, operation: () => Promise<T>): Promise<T> {
  if (!observer.isActive(sessionName)) return operation();
  const started = Date.now();
  try {
    const result = await operation();
    safeObserve(() => {
      observer.count(sessionName, kind);
      observer.count(sessionName, `${kind}_keys`, keys);
      observer.max(sessionName, `${kind}_ms`, Date.now() - started);
      if (kind === "signal_write") observer.mark(sessionName, "signal_write");
    });
    return result;
  } catch (error) {
    safeObserve(() => { observer.count(sessionName, `${kind}_fail`); observer.max(sessionName, `${kind}_ms`, Date.now() - started); });
    throw error;
  }
}

observer.registerGlobalProbe("auth_queue", (sessionName) => authQueueStats(sessionName));

export type AuthStateOptions = {
  /** Chamado quando a leitura de chaves deste número esgota as tentativas. Deve pôr só este número em recuperação. */
  onKeysUnavailable?: (error: AuthKeysUnavailableError) => void;
};

export async function useSupabaseAuthState(sessionName = "default", requestedAccountId?: string, options: AuthStateOptions = {}) {
  const data = await dbResult<{ creds: unknown; account_id: string }>(
    `auth.load:${sessionName}`,
    supabase.from("whatsapp_auth_creds").select("creds,account_id").eq("session_name", sessionName).maybeSingle()
  );
  const accountId = requestedAccountId || data?.account_id;
  let creds: AuthenticationCreds = data?.creds ? deserialize(data.creds) : initAuthCreds();
  const lockKey = `${accountId || "unknown"}:${sessionName}`;
  // Disjuntor da leitura de chaves deste número (ver key-read-guard.ts).
  const keyOutage = { consecutive: 0, until: 0 };

  function unavailable(attempts: number, cooldownMs: number, cause?: unknown) {
    const error = new AuthKeysUnavailableError(sessionName, attempts, cooldownMs, { cause });
    if (options.onKeysUnavailable) {
      try {
        options.onKeysUnavailable(error);
        error.recoveryRequested = true;
      } catch (hookError) {
        console.error({ event: "auth.keys.recovery_hook_failed", component: "auth", session_name: sessionName, message: String((hookError as Error)?.message || hookError) });
      }
    }
    if (attempts) console.error({ event: "auth.keys.get.unavailable", component: "auth", session_name: sessionName, attempts, cooldown_ms: cooldownMs, recovery_requested: error.recoveryRequested });
    return error;
  }

  function openKeyOutage(attempts: number, cause: unknown) {
    keyOutage.consecutive += 1;
    const cooldownMs = keyOutageCooldown(keyOutage.consecutive);
    keyOutage.until = Date.now() + cooldownMs;
    return unavailable(attempts, cooldownMs, cause);
  }

  async function saveCreds() {
    if (!accountId) throw new Error("Conta da sessão WhatsApp não identificada.");
    const snapshot = serialize(creds);
    await withAuthOperationLock(lockKey, async () => {
      await dbResult(
        `auth.save:${sessionName}`,
        supabase.from("whatsapp_auth_creds").upsert({ account_id: accountId, session_name: sessionName, creds: snapshot, updated_at: new Date().toISOString() })
      );
    }, sessionName);
  }

  return {
    state: {
      creds,
      keys: makeCacheableSignalKeyStore(batchKeyStore({
        get: async (type: string, ids: string[]) => withAuthOperationLock(lockKey, () => measureKeyOperation(sessionName, "signal_read", ids.length, async () => {
          if (!accountId) throw new Error("Conta da sessão WhatsApp não identificada.");
          if (!ids.length) return {};
          const result: Record<string, any> = {};

          // Número em recuperação: falha na hora, sem ir ao banco e sem fingir chave ausente.
          if (Date.now() < keyOutage.until) throw unavailable(0, keyOutage.until - Date.now());
          const started = Date.now();

          async function fetchBatch(batch: string[]): Promise<void> {
            for (let attempt = 1; ; attempt++) {
              try {
                const rows = await dbResult(
                  `auth.keys.get:${sessionName}`,
                  supabase.from("whatsapp_auth_keys").select("key_id,key_data").eq("session_name", sessionName).eq("account_id", accountId).eq("key_type", type).in("key_id", batch)
                );
                for (const id of batch) {
                  const row = (rows as any[])?.find((r) => r.key_id === id);
                  if (row?.key_data) result[id] = retainSessions(sessionName, type, id, deserialize(row.key_data), "read");
                }
                if (attempt > 1) console.info({ event: "auth.keys.get.recovered", component: "auth", session_name: sessionName, type, attempt });
                return;
              } catch (error) {
                const msg = (error as Error)?.message || "";
                const isTemporary = isTemporaryKeyReadError(error);
                const isBadRequest = !isTemporary && /bad request/i.test(msg);
                if (isTemporary) {
                  const delay = keyReadRetryDelay(attempt);
                  const withinBudget = Date.now() - started + delay < KEY_READ_POLICY.budgetMs;
                  console.warn({ event: "auth.keys.get.temporary_failure", component: "auth", session_name: sessionName, type, attempt,
                    will_retry: attempt < KEY_READ_POLICY.maxAttempts && withinBudget, reason: msg.replace(/\s+/g, " ").slice(0, 120) });
                  if (attempt < KEY_READ_POLICY.maxAttempts && withinBudget) {
                    await new Promise((resolve) => setTimeout(resolve, delay));
                    continue;
                  }
                  throw openKeyOutage(attempt, error);
                }
                // Bad Request with multiple keys: isolate the bad key by trying one-by-one.
                // A single key only skips on Bad Request; any other failure of it must
                // reject the read (swallowing it here turned an outage into "missing key").
                if (isBadRequest && batch.length > 1) {
                  for (const id of batch) await fetchBatch([id]);
                  return;
                }
                // Only a malformed stored key is equivalent to a missing key.
                // Infrastructure errors must propagate or Signal advances with bad state.
                if (isBadRequest) {
                  console.warn({ event: "auth.keys.get.malformed_key_skipped", sessionName, type, keys: batch.length, reason: msg });
                  return;
                }
                // Erro não temporário (ex.: permissão): sem repetir, mas o número entra em
                // recuperação em vez de a rejeição derrubar o processo com todos os números.
                throw openKeyOutage(attempt, error);
              }
            }
          }

          // Batch to 100 keys per request to keep URLs within server limits.
          // Any failed batch rejects the whole read: a partial result would look like missing keys.
          for (let i = 0; i < ids.length; i += 100) {
            await fetchBatch(ids.slice(i, i + 100));
          }
          keyOutage.consecutive = 0;
          return result;
        }), sessionName),
        set: async (data: SignalDataSet) => withAuthOperationLock(lockKey, () => measureKeyOperation(sessionName, "signal_write", Object.values(data || {}).reduce((total, records) => total + Object.keys(records || {}).length, 0), async () => {
          if (!accountId) throw new Error("Conta da sessão WhatsApp não identificada.");
          for (const [type, records] of Object.entries(data)) {
            const entries = Object.entries(records || {});
            if (!entries.length) continue;

            const toUpsert = entries.filter(([, v]) => v != null).map(([id, value]) => ({
              account_id: accountId,
              session_name: sessionName,
              key_type: type,
              key_id: id,
              key_data: serialize(retainSessions(sessionName, type, id, value, "write")),
              updated_at: new Date().toISOString()
            }));

            const toDelete = entries.filter(([, v]) => v == null).map(([id]) => id);

            if (toUpsert.length) {
              await dbResult(`auth.keys.upsert:${sessionName}`, supabase.from("whatsapp_auth_keys").upsert(toUpsert));
            }

            if (toDelete.length) {
              await dbResult(
                `auth.keys.delete:${sessionName}`,
                supabase.from("whatsapp_auth_keys").delete().eq("session_name", sessionName).eq("account_id", accountId).eq("key_type", type).in("key_id", toDelete)
              );
            }
          }
        }), sessionName),
        clear: async () => withAuthOperationLock(lockKey, async () => {
          if (!accountId) throw new Error("Conta da sessão WhatsApp não identificada.");
          await dbResult(
            `auth.keys.clear:${sessionName}`,
            supabase.from("whatsapp_auth_keys").delete().eq("session_name", sessionName).eq("account_id", accountId)
          );
        })
      }))
    },
    saveCreds,
    clearAuth: async () => {
      await withAuthOperationLock(lockKey, async () => {
        await dbResult(
          `auth.keys.clear:${sessionName}`,
          supabase.from("whatsapp_auth_keys").delete().eq("session_name", sessionName).eq("account_id", accountId)
        );
        await dbResult(
          `auth.creds.clear:${sessionName}`,
          supabase.from("whatsapp_auth_creds").delete().eq("session_name", sessionName).eq("account_id", accountId)
        );
        creds = initAuthCreds();
      });
    },
    waitForIdle: async () => { await (authOperationTails.get(lockKey) || Promise.resolve()).catch(() => undefined); }
  };
}
