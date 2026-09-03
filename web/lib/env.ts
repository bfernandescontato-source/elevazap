import { z } from "zod";

const serverEnvSchema = z.object({
  NEXT_PUBLIC_APP_URL: z.string().url(),
  SUPABASE_URL: z.string().url(),
  SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_KEY: z.string().min(1),
  WHATSAPP_SERVICE_URL: z.string().url(),
  INTERNAL_API_KEY: z.string().min(24),
  ELEVAPAY_WEBHOOK_TOKEN: z.string().min(16),
  HUBLA_WEBHOOK_TOKEN: z.string().min(16).optional(),
  MEU_NUMERO_TESTE: z.string().min(10),
  ADMIN_EMAIL: z.string().email(),
  ADMIN_PASSWORD_HASH: z.string().min(20),
  AUTH_SECRET: z.string().min(32),
  INTEGRATION_ENCRYPTION_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().default("gpt-5.6-luna"),
  MERCADO_LIVRE_CLIENT_ID: z.string().min(10).optional(),
  MERCADO_LIVRE_CLIENT_SECRET: z.string().min(10).optional(),
  MERCADO_LIVRE_REDIRECT_URI: z.string().url().optional(),
  MERCADO_LIVRE_COLLECTOR_TOKEN_HASH: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  META_WABA_ID: z.string().min(1).optional(),
  META_PHONE_NUMBER_ID: z.string().min(1).optional(),
  META_ACCESS_TOKEN: z.string().min(1).optional(),
  META_GRAPH_VERSION: z.string().min(1).optional(),
  HUBLA_WEBHOOK_SECRET: z.string().min(16).optional(),
  META_WEBHOOK_VERIFY_TOKEN: z.string().min(16).optional(),
  META_APP_SECRET: z.string().min(16).optional(),
  OFFICIAL_BROADCAST_CONCURRENCY: z.coerce.number().int().min(1).max(20).optional()
});

export function env() {
  return serverEnvSchema.parse(process.env);
}

export function appUrl() {
  const configured = env().NEXT_PUBLIC_APP_URL;
  if (process.env.NODE_ENV === "production" && new URL(configured).hostname === "localhost") {
    return "https://www.disparei.pro";
  }
  return configured;
}
