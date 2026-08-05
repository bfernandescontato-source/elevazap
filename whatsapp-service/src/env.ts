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
  DB_TIMEOUT_MS: z.coerce.number().int().min(1000).default(10_000),
  SEND_TIMEOUT_MS: z.coerce.number().int().min(1000).default(30_000),
  MEDIA_DOWNLOAD_TIMEOUT_MS: z.coerce.number().int().min(1000).default(30_000),
  FFMPEG_TIMEOUT_MS: z.coerce.number().int().min(1000).default(60_000),
  GROUP_SYNC_TIMEOUT_MS: z.coerce.number().int().min(1000).default(30_000),
  WHATSAPP_START_TIMEOUT_MS: z.coerce.number().int().min(1000).default(30_000),
  WHATSAPP_STOP_TIMEOUT_MS: z.coerce.number().int().min(1000).default(7_000),
  QUEUE_PROCESSING_TIMEOUT_MS: z.coerce.number().int().min(5000).default(120_000),
  MAX_SEND_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(3),
  RETRY_BASE_DELAY_MS: z.coerce.number().int().min(1000).default(60_000),
  WELCOME_UNCERTAIN_POLICY: z.string().default("manual")
});

export const env = schema.parse(process.env);
