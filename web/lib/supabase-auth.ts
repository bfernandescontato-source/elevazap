import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { env } from "./env";

export async function supabaseAuth() {
  const cookieStore = await cookies();
  const e = env();

  return createServerClient(e.SUPABASE_URL, e.SUPABASE_ANON_KEY, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (cookiesToSet) => {
        for (const { name, value, options } of cookiesToSet) {
          cookieStore.set(name, value, options);
        }
      }
    }
  });
}
