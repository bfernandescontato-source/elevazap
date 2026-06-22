import { z } from "zod";

const serverEnvSchema = z.object({
  NEXT_PUBLIC_APP_URL: z.string().url(),
  SUPABASE_URL: z.string().url(),
  SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_KEY: z.string().min(1),
  WHATSAPP_SERVICE_URL: z.string().url(),
  INTERNAL_API_KEY: z.string().min(24),
  ELEVAPAY_WEBHOOK_TOKEN: z.string().min(16),
  MEU_NUMERO_TESTE: z.string().min(10),
  ADMIN_EMAIL: z.string().email(),
  ADMIN_PASSWORD_HASH: z.string().min(20),
  AUTH_SECRET: z.string().min(32)
});

export function env() {
  return serverEnvSchema.parse(process.env);
}
