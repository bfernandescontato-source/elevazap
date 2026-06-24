import { randomUUID } from "crypto";
import { z } from "zod";

const schema = z.object({
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_KEY: z.string().min(1),
  INTERNAL_API_KEY: z.string().min(24),
  PORT: z.coerce.number().default(3001),
  GLOBAL_SEND_THROTTLE_MS: z.coerce.number().default(1000),
  INSTANCE_ID: z.string().default(randomUUID()),
  LOCK_TTL_SECONDS: z.coerce.number().default(60),
  WELCOME_UNCERTAIN_POLICY: z.string().default("manual"),
  LLM_PROVIDER: z.enum(["openai", "anthropic"]).default("openai"),
  OPENAI_API_KEY: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  ELEVAPAY_API_URL: z.string().url().optional(),
  ELEVAPAY_API_KEY: z.string().optional(),
  SUPPORT_NOTIFY_JID: z.string().optional()
});

export const env = schema.parse(process.env);
