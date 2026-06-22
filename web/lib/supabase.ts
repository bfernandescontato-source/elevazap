import { createClient } from "@supabase/supabase-js";
import { env } from "./env";

export function supabaseAdmin() {
  const e = env();
  return createClient(e.SUPABASE_URL, e.SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false }
  });
}
