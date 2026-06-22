import { initAuthCreds, proto, type AuthenticationCreds, type SignalDataSet } from "@whiskeysockets/baileys";
import { BufferJSON } from "@whiskeysockets/baileys";
import { supabase } from "../supabase.js";

const sessionName = "default";

function serialize(data: unknown) {
  return JSON.parse(JSON.stringify(data, BufferJSON.replacer));
}

function deserialize<T>(data: unknown): T {
  return JSON.parse(JSON.stringify(data), BufferJSON.reviver);
}

export async function useSupabaseAuthState() {
  const { data } = await supabase.from("whatsapp_auth_creds").select("creds").eq("session_name", sessionName).maybeSingle();
  let creds: AuthenticationCreds = data?.creds ? deserialize(data.creds) : initAuthCreds();

  async function saveCreds() {
    await supabase.from("whatsapp_auth_creds").upsert({ session_name: sessionName, creds: serialize(creds), updated_at: new Date().toISOString() });
  }

  return {
    state: {
      creds,
      keys: {
        get: async (type: string, ids: string[]) => {
          const { data: rows } = await supabase.from("whatsapp_auth_keys").select("key_id,key_data").eq("session_name", sessionName).eq("key_type", type).in("key_id", ids);
          const result: Record<string, any> = {};
          for (const id of ids) {
            const row = rows?.find((r) => r.key_id === id);
            if (row?.key_data) result[id] = deserialize(row.key_data);
          }
          return result;
        },
        set: async (data: SignalDataSet) => {
          for (const [type, records] of Object.entries(data)) {
            for (const [id, value] of Object.entries(records || {})) {
              if (value) {
                await supabase.from("whatsapp_auth_keys").upsert({ session_name: sessionName, key_type: type, key_id: id, key_data: serialize(value), updated_at: new Date().toISOString() });
              } else {
                await supabase.from("whatsapp_auth_keys").delete().eq("session_name", sessionName).eq("key_type", type).eq("key_id", id);
              }
            }
          }
        }
      }
    },
    saveCreds,
    clearAuth: async () => {
      await supabase.from("whatsapp_auth_keys").delete().eq("session_name", sessionName);
      await supabase.from("whatsapp_auth_creds").delete().eq("session_name", sessionName);
      creds = initAuthCreds();
    }
  };
}
