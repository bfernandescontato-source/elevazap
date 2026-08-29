import { createClient } from "@supabase/supabase-js";
import { env } from "./env";

type SupabaseAdminOptions = {
  timeoutMs?: number;
};

export function supabaseAdmin(options: SupabaseAdminOptions = {}) {
  const e = env();
  return createClient(e.SUPABASE_URL, e.SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false },
    ...(options.timeoutMs ? {
      global: {
        fetch: (input, init = {}) => {
          const timeout = AbortSignal.timeout(options.timeoutMs!);
          const signal = init.signal
            ? AbortSignal.any([init.signal, timeout])
            : timeout;
          return fetch(input, { ...init, signal });
        }
      }
    } : {})
  });
}
