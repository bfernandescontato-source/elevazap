import { initAuthCreds, proto, type AuthenticationCreds, type SignalDataSet } from "@whiskeysockets/baileys";
import { BufferJSON } from "@whiskeysockets/baileys";
import { supabase } from "../supabase.js";
import { dbResult } from "../utils/db.js";

function serialize(data: unknown) {
  return JSON.parse(JSON.stringify(data, BufferJSON.replacer));
}

function deserialize<T>(data: unknown): T {
  return JSON.parse(JSON.stringify(data), BufferJSON.reviver);
}

export async function useSupabaseAuthState(sessionName = "default", requestedAccountId?: string) {
  const data = await dbResult<{ creds: unknown; account_id: string }>(
    `auth.load:${sessionName}`,
    supabase.from("whatsapp_auth_creds").select("creds,account_id").eq("session_name", sessionName).maybeSingle()
  );
  const accountId = requestedAccountId || data?.account_id;
  let creds: AuthenticationCreds = data?.creds ? deserialize(data.creds) : initAuthCreds();

  async function saveCreds() {
    if (!accountId) throw new Error("Conta da sessão WhatsApp não identificada.");
    await dbResult(
      `auth.save:${sessionName}`,
      supabase.from("whatsapp_auth_creds").upsert({ account_id: accountId, session_name: sessionName, creds: serialize(creds), updated_at: new Date().toISOString() })
    );
  }

  return {
    state: {
      creds,
      keys: {
        get: async (type: string, ids: string[]) => {
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
                const isNetwork = /fetch failed|network|econnreset|enotfound|econnrefused/i.test(msg);
                const isBadRequest = /bad request/i.test(msg);
                if (isNetwork && attempt < 3) {
                  await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
                  continue;
                }
                // Bad Request with multiple keys: isolate the bad key by trying one-by-one
                if (isBadRequest && batch.length > 1) {
                  for (const id of batch) await fetchBatch([id]).catch(() => undefined);
                  return;
                }
                // Single bad key or persistent failure: skip — Baileys re-creates missing keys on next send
                console.warn({ event: "auth.keys.get.skipped", sessionName, type, keys: batch.length, reason: msg });
                return;
              }
            }
          }

          // Batch to 50 keys per request to keep URLs within server limits
          for (let i = 0; i < ids.length; i += 50) {
            await fetchBatch(ids.slice(i, i + 50));
          }
          return result;
        },
        set: async (data: SignalDataSet) => {
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
        }
      }
    },
    saveCreds,
    clearAuth: async () => {
      await dbResult(
        `auth.keys.clear:${sessionName}`,
        supabase.from("whatsapp_auth_keys").delete().eq("session_name", sessionName).eq("account_id", accountId)
      );
      await dbResult(
        `auth.creds.clear:${sessionName}`,
        supabase.from("whatsapp_auth_creds").delete().eq("session_name", sessionName).eq("account_id", accountId)
      );
      creds = initAuthCreds();
    }
  };
}
