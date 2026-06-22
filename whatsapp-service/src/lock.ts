import { env } from "./env.js";
import { supabase } from "./supabase.js";

export async function acquireLock() {
  const { data, error } = await supabase.rpc("acquire_service_lock", {
    p_id: "whatsapp-main",
    p_instance_id: env.INSTANCE_ID,
    p_ttl_seconds: env.LOCK_TTL_SECONDS
  });
  if (error) throw error;
  return Boolean(data);
}

export async function renewLock() {
  const { data, error } = await supabase.rpc("renew_service_lock", {
    p_id: "whatsapp-main",
    p_instance_id: env.INSTANCE_ID
  });
  if (error) throw error;
  return Boolean(data);
}
