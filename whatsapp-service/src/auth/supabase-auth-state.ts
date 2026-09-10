import { initAuthCreds, makeCacheableSignalKeyStore, proto, type AuthenticationCreds, type SignalDataSet } from "@whiskeysockets/baileys";
import { BufferJSON } from "@whiskeysockets/baileys";
import { supabase } from "../supabase.js";
import { dbResult } from "../utils/db.js";

function serialize(data: unknown) {
  return JSON.parse(JSON.stringify(data, BufferJSON.replacer));
}

function deserialize<T>(data: unknown): T {
  return JSON.parse(JSON.stringify(data), BufferJSON.reviver);
}

// Signal ratchets are read-modify-write state. Keep auth operations ordered so
// an older concurrent write cannot replace a newer cryptographic state.
const authOperationTails = new Map<string, Promise<void>>();

async function withAuthOperationLock<T>(lockKey: string, operation: () => Promise<T>): Promise<T> {
  const previous = authOperationTails.get(lockKey) || Promise.resolve();
  let releaseCurrent!: () => void;
  const current = new Promise<void>((resolve) => { releaseCurrent = resolve; });
  const tail = previous.catch(() => undefined).then(() => current);
  authOperationTails.set(lockKey, tail);
  await previous.catch(() => undefined);
  try {
    return await operation();
  } finally {
    releaseCurrent();
    if (authOperationTails.get(lockKey) === tail) authOperationTails.delete(lockKey);
  }
}

export async function useSupabaseAuthState(sessionName = "default", requestedAccountId?: string) {
  const data = await dbResult<{ creds: unknown; account_id: string }>(
    `auth.load:${sessionName}`,
    supabase.from("whatsapp_auth_creds").select("creds,account_id").eq("session_name", sessionName).maybeSingle()
  );
  const accountId = requestedAccountId || data?.account_id;
  let creds: AuthenticationCreds = data?.creds ? deserialize(data.creds) : initAuthCreds();
  const lockKey = `${accountId || "unknown"}:${sessionName}`;

  async function saveCreds() {
    if (!accountId) throw new Error("Conta da sessão WhatsApp não identificada.");
    const snapshot = serialize(creds);
    await withAuthOperationLock(lockKey, async () => {
      await dbResult(
        `auth.save:${sessionName}`,
        supabase.from("whatsapp_auth_creds").upsert({ account_id: accountId, session_name: sessionName, creds: snapshot, updated_at: new Date().toISOString() })
      );
    });
  }

  return {
    state: {
      creds,
      keys: makeCacheableSignalKeyStore({
        get: async (type: string, ids: string[]) => withAuthOperationLock(lockKey, async () => {
          if (!accountId) throw new Error("Conta da sessão WhatsApp não identificada.");
          if (!ids.length) return {};
          const result: Record<string, any> = {};

          async function fetchBatch(batch: string[]): Promise<void> {
            for (let attempt = 1; attempt <= 3; attempt++) {
              try {
                const rows = await dbResult(
                  `auth.keys.get:${sessionName}`,
                  supabase.from("whatsapp_auth_keys").select("key_id,key_data").eq("session_name", sessionName).eq("account_id", accountId).eq("key_type", type).in("key_id", batch)
                );
                for (const id of batch) {
                  const row = (rows as any[])?.find((r) => r.key_id === id);
                  if (row?.key_data) result[id] = deserialize(row.key_data);
                }
                return;
              } catch (error) {
                const msg = (error as Error)?.message || "";
                const isTemporary = /fetch failed|network|econnreset|enotfound|econnrefused|excedeu o limite|timeout/i.test(msg);
                const isBadRequest = /bad request/i.test(msg);
                if (isTemporary && attempt < 3) {
                  await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
                  continue;
                }
                // Bad Request with multiple keys: isolate the bad key by trying one-by-one
                if (isBadRequest && batch.length > 1) {
                  for (const id of batch) await fetchBatch([id]).catch(() => undefined);
                  return;
                }
                // Only a malformed stored key is equivalent to a missing key.
                // Infrastructure errors must propagate or Signal advances with bad state.
                if (isBadRequest) {
                  console.warn({ event: "auth.keys.get.malformed_key_skipped", sessionName, type, keys: batch.length, reason: msg });
                  return;
                }
                throw error;
              }
            }
          }

          // Batch to 50 keys per request to keep URLs within server limits
          for (let i = 0; i < ids.length; i += 50) {
            await fetchBatch(ids.slice(i, i + 50));
          }
          return result;
        }),
        set: async (data: SignalDataSet) => withAuthOperationLock(lockKey, async () => {
          if (!accountId) throw new Error("Conta da sessão WhatsApp não identificada.");
          for (const [type, records] of Object.entries(data)) {
            const entries = Object.entries(records || {});
            if (!entries.length) continue;

            const toUpsert = entries.filter(([, v]) => v != null).map(([id, value]) => ({
              account_id: accountId,
              session_name: sessionName,
              key_type: type,
              key_id: id,
              key_data: serialize(value),
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
        }),
        clear: async () => withAuthOperationLock(lockKey, async () => {
          if (!accountId) throw new Error("Conta da sessão WhatsApp não identificada.");
          await dbResult(
            `auth.keys.clear:${sessionName}`,
            supabase.from("whatsapp_auth_keys").delete().eq("session_name", sessionName).eq("account_id", accountId)
          );
        })
      })
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
