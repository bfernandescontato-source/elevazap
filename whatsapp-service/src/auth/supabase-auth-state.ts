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

export async function useSupabaseAuthState(sessionName = "default") {
  const data = await dbResult<{ creds: unknown }>(
    `auth.load:${sessionName}`,
    supabase.from("whatsapp_auth_creds").select("creds").eq("session_name", sessionName).maybeSingle()
  );
  let creds: AuthenticationCreds = data?.creds ? deserialize(data.creds) : initAuthCreds();

  async function saveCreds() {
    await dbResult(
      `auth.save:${sessionName}`,
      supabase.from("whatsapp_auth_creds").upsert({ session_name: sessionName, creds: serialize(creds), updated_at: new Date().toISOString() })
    );
  }

  return {
    state: {
      creds,
      keys: {
        get: async (type: string, ids: string[]) => {
          const rows = await dbResult(
            `auth.keys.get:${sessionName}`,
            supabase.from("whatsapp_auth_keys").select("key_id,key_data").eq("session_name", sessionName).eq("key_type", type).in("key_id", ids)
          );
          const result: Record<string, any> = {};
          for (const id of ids) {
            const row = rows?.find((r) => r.key_id === id);
            if (row?.key_data) result[id] = deserialize(row.key_data);
          }
          return result;
        },
        set: async (data: SignalDataSet) => {
          for (const [type, records] of Object.entries(data)) {
            const entries = Object.entries(records || {});
            if (!entries.length) continue;

            const toUpsert = entries.filter(([, v]) => v != null).map(([id, value]) => ({
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
                supabase.from("whatsapp_auth_keys").delete().eq("session_name", sessionName).eq("key_type", type).in("key_id", toDelete)
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
        supabase.from("whatsapp_auth_keys").delete().eq("session_name", sessionName)
      );
      await dbResult(
        `auth.creds.clear:${sessionName}`,
        supabase.from("whatsapp_auth_creds").delete().eq("session_name", sessionName)
      );
      creds = initAuthCreds();
    }
  };
}
