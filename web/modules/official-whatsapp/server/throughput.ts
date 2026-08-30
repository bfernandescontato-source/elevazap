const STANDARD_THROUGHPUT_MPS = 80;
const HIGH_THROUGHPUT_MPS = 1_000;

export const URGENT_BROADCAST_MAX_CONCURRENCY = 60;
export const URGENT_BROADCAST_SAFE_FALLBACK = 20;

function positiveInteger(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : null;
}

// A Graph API atualmente devolve throughput como objeto (ex.: { level: "STANDARD" }),
// mas versões anteriores e mocks podem devolver um número. Aceitamos os dois formatos.
export function parseMetaThroughputMps(value: unknown): number | null {
  const direct = positiveInteger(value);
  if (direct) return direct;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;

  const record = value as Record<string, unknown>;
  for (const key of ["messages_per_second", "mps", "value"]) {
    const parsed = positiveInteger(record[key]);
    if (parsed) return parsed;
  }

  const level = typeof record.level === "string" ? record.level.trim().toUpperCase() : "";
  if (level === "STANDARD") return STANDARD_THROUGHPUT_MPS;
  if (level === "HIGH") return HIGH_THROUGHPUT_MPS;
  return null;
}

export function urgentBroadcastConcurrency(metaThroughputMps: number | null) {
  if (!metaThroughputMps) return URGENT_BROADCAST_SAFE_FALLBACK;
  return Math.min(
    URGENT_BROADCAST_MAX_CONCURRENCY,
    Math.max(URGENT_BROADCAST_SAFE_FALLBACK, Math.floor(metaThroughputMps * 0.75))
  );
}
