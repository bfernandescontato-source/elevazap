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
  MAX_SESSIONS_PER_WORKER: z.coerce.number().int().min(1).max(1000).default(200),
  SYSTEM_MAX_CONCURRENT_SENDS: z.coerce.number().int().min(1).max(500).default(50),
  ACCOUNT_MAX_CONCURRENT_SENDS: z.coerce.number().int().min(1).max(100).default(10),
  GROUP_BATCH_MAX_CONCURRENT_SENDS: z.coerce.number().int().min(1).max(5).default(5),
  DISPATCH_BATCH_SIZE: z.coerce.number().int().min(1).max(500).default(50),
  DISPATCH_POLL_MS: z.coerce.number().int().min(100).max(30_000).default(1000),
  SESSION_LEASE_TTL_SECONDS: z.coerce.number().int().min(15).max(300).default(60),
  SESSION_SUPERVISOR_INTERVAL_MS: z.coerce.number().int().min(1000).max(60_000).default(15_000),
  SESSION_START_STAGGER_MS: z.coerce.number().int().min(0).max(5_000).default(250),
  CIRCUIT_BREAKER_FAILURE_THRESHOLD: z.coerce.number().int().min(1).max(100).default(5),
  CIRCUIT_BREAKER_COOLDOWN_MS: z.coerce.number().int().min(1000).max(3_600_000).default(300_000),
  DB_TIMEOUT_MS: z.coerce.number().int().min(1000).default(10_000),
  SEND_TIMEOUT_MS: z.coerce.number().int().min(1000).default(30_000),
  MEDIA_DOWNLOAD_TIMEOUT_MS: z.coerce.number().int().min(1000).default(30_000),
  MEDIA_CACHE_MAX_BYTES: z.coerce.number().int().min(1_048_576).default(256 * 1024 * 1024),
  MEDIA_CACHE_TTL_MS: z.coerce.number().int().min(1_000).default(30 * 60_000),
  TEMPORARY_MEDIA_GC_INTERVAL_MS: z.coerce.number().int().min(60_000).default(60 * 60_000),
  TEMPORARY_MEDIA_GC_MIN_AGE_MS: z.coerce.number().int().min(3_600_000).default(48 * 60 * 60_000),
  // Enable only after the first audited inventory in production.
  TEMPORARY_MEDIA_GC_ENABLED: z.coerce.boolean().default(false),
  FFMPEG_TIMEOUT_MS: z.coerce.number().int().min(1000).default(60_000),
  GROUP_SYNC_TIMEOUT_MS: z.coerce.number().int().min(1000).default(30_000),
  WHATSAPP_START_TIMEOUT_MS: z.coerce.number().int().min(1000).default(30_000),
  WHATSAPP_STOP_TIMEOUT_MS: z.coerce.number().int().min(1000).default(7_000),
  QUEUE_PROCESSING_TIMEOUT_MS: z.coerce.number().int().min(5000).default(120_000),
  OFFER_PROCESSING_TIMEOUT_MS: z.coerce.number().int().min(60_000).max(3_600_000).default(900_000),
  MAX_SEND_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(3),
  RETRY_BASE_DELAY_MS: z.coerce.number().int().min(1000).default(60_000),
  WELCOME_UNCERTAIN_POLICY: z.string().default("manual"),
  INTEGRATION_ENCRYPTION_KEY: z.string().optional(),
  // Observabilidade da investigação do número surdo. Desligada por padrão:
  // liga só com OBS_ENABLED=true ou por POST /obs/config. z.coerce.boolean
  // trata "false" como true, por isso a comparação explícita.
  OBS_ENABLED: z.string().default("false").transform((value) => value === "true"),
  // Limite de 40 sessões por registro Signal também na leitura/gravação do banco
  // (src/auth/signal-session-retention.ts). "off" volta ao comportamento antigo.
  SIGNAL_SESSION_RETENTION: z.string().default("on").transform((value) => value !== "off"),
  OBS_PERSIST: z.string().default("true").transform((value) => value !== "false"),
  OBS_FLUSH_MS: z.coerce.number().int().min(60_000).max(3_600_000).default(300_000),
  OBS_DETECT_MS: z.coerce.number().int().min(5_000).max(300_000).default(30_000),
  OBS_RING_MINUTES: z.coerce.number().int().min(10).max(180).default(60),
  // Lista de números (session_name, separados por vírgula) para o canary;
  // vazio = todos. Supervisor e event loop são sempre do processo inteiro.
  OBS_SESSIONS: z.string().default(""),
  OBS_RETENTION_DAYS: z.coerce.number().int().min(1).max(90).default(3),
  OBS_INCIDENT_RETENTION_DAYS: z.coerce.number().int().min(1).max(90).default(14),
  OBS_INCIDENT_MAX_PER_HOUR: z.coerce.number().int().min(1).max(500).default(30),
  OBS_SNAPSHOT_MINUTES: z.coerce.number().int().min(5).max(180).default(30),
  OBS_CRASH_DIR: z.string().default("/tmp"),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().default("gpt-5.6"),
  OPENAI_REWRITE_MODEL: z.string().default("gpt-4o-mini")
});

export const env = schema.parse(process.env);
