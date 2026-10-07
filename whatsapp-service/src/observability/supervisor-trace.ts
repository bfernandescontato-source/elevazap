import { monitorEventLoopDelay, type IntervalHistogram } from "perf_hooks";
import { observer, PROCESS_SESSION } from "./observer.js";

/**
 * Mede o supervisor de sessões (renovação de posse + sincronização) e o laço
 * de eventos. Pergunta: por que o supervisor ficou mais de 60 s sem renovar
 * às 14:33 de 07/10, deixando as 72 posses vencerem juntas?
 *
 * Só mede: não muda a ordem, o intervalo nem a concorrência dos ciclos.
 */

const SLOW_CYCLE_MS = 10_000;
const RECENT_CYCLES = 240; // ~1 h com o intervalo padrão de 15 s
const nsToMs = (ns: number) => Math.round((ns / 1e6) * 10) / 10;

type Op = { name: string; session?: string; ms: number; ok: boolean };

export type CycleSummary = {
  cycle: number;
  started_at: string;
  duration_ms: number;
  overlapping: boolean;
  concurrent_cycles: number;
  eld_max_ms: number;
  eld_p99_ms: number;
  counts: Record<string, number>;
  ops_total_ms: Record<string, number>;
  slowest: Op[];
  error: string | null;
};

function histogramSummary(histogram: IntervalHistogram) {
  return { max: nsToMs(histogram.max), p99: nsToMs(histogram.percentile(99)), p50: nsToMs(histogram.percentile(50)), mean: nsToMs(histogram.mean) };
}

// ---- laço de eventos (processo inteiro) ----------------------------------

const processLoop = monitorEventLoopDelay({ resolution: 20 });
let processLoopEnabled = false;
let lastLoopSample = { max: 0, p99: 0, p50: 0, mean: 0, at: 0 };

export function startEventLoopMonitor() {
  if (processLoopEnabled) return;
  processLoop.enable();
  processLoopEnabled = true;
}

/** Fecha a janela atual do laço de eventos e grava no minuto do processo. */
export function sampleEventLoop() {
  if (!processLoopEnabled) return lastLoopSample;
  const summary = histogramSummary(processLoop);
  processLoop.reset();
  lastLoopSample = { ...summary, at: Date.now() };
  observer.max(PROCESS_SESSION, "eld_max_ms", summary.max);
  observer.max(PROCESS_SESSION, "eld_p99_ms", summary.p99);
  observer.count(PROCESS_SESSION, "eld_samples");
  if (summary.max >= 1000) observer.count(PROCESS_SESSION, "eld_over_1s");
  return lastLoopSample;
}

export function recentEventLoop() {
  const running = processLoopEnabled ? histogramSummary(processLoop) : null;
  return { last_window: lastLoopSample, current_window: running };
}

// ---- supervisor ------------------------------------------------------------

const recentCycles: CycleSummary[] = [];
let activeCycles = 0;
let cycleSeq = 0;

export class SupervisorCycle {
  readonly id = ++cycleSeq;
  private readonly startedAt = Date.now();
  readonly overlapping: boolean;
  private readonly concurrent: number;
  private readonly loop = monitorEventLoopDelay({ resolution: 20 });
  private readonly ops: Op[] = [];
  private readonly counts: Record<string, number> = {};
  private ended = false;

  constructor() {
    this.overlapping = activeCycles > 0;
    activeCycles += 1;
    this.concurrent = activeCycles;
    this.loop.enable();
  }

  count(key: string, n = 1) { this.counts[key] = (this.counts[key] || 0) + n; }

  async time<T>(name: string, session: string | undefined, operation: () => Promise<T>): Promise<T> {
    const started = Date.now();
    let ok = false;
    try {
      const result = await operation();
      ok = true;
      return result;
    } finally {
      this.ops.push({ name, session, ms: Date.now() - started, ok });
    }
  }

  end(error?: unknown) {
    if (this.ended) return null;
    this.ended = true;
    activeCycles = Math.max(0, activeCycles - 1);
    this.loop.disable();
    const loop = histogramSummary(this.loop);
    const opsTotal: Record<string, number> = {};
    for (const op of this.ops) opsTotal[op.name] = (opsTotal[op.name] || 0) + op.ms;
    const summary: CycleSummary = {
      cycle: this.id,
      started_at: new Date(this.startedAt).toISOString(),
      duration_ms: Date.now() - this.startedAt,
      overlapping: this.overlapping,
      concurrent_cycles: this.concurrent,
      eld_max_ms: loop.max,
      eld_p99_ms: loop.p99,
      counts: { ...this.counts },
      ops_total_ms: opsTotal,
      slowest: this.ops.slice().sort((a, b) => b.ms - a.ms).slice(0, 5),
      error: error ? String((error as any)?.message || error) : null
    };
    recentCycles.push(summary);
    while (recentCycles.length > RECENT_CYCLES) recentCycles.shift();

    observer.count(PROCESS_SESSION, "supervisor_cycles");
    observer.max(PROCESS_SESSION, "supervisor_cycle_ms", summary.duration_ms);
    observer.max(PROCESS_SESSION, "supervisor_eld_max_ms", summary.eld_max_ms);
    if (summary.overlapping) observer.count(PROCESS_SESSION, "supervisor_overlaps");
    if (summary.error) observer.count(PROCESS_SESSION, "supervisor_errors");
    for (const [key, value] of Object.entries(summary.counts)) observer.count(PROCESS_SESSION, `supervisor_${key}`, value);

    const notable = summary.duration_ms >= SLOW_CYCLE_MS || summary.overlapping || summary.error
      || (summary.counts.renew_lost || 0) > 0 || (summary.counts.sessions_started || 0) > 0 || (summary.counts.sessions_stopped || 0) > 0;
    if (notable) console.warn({ event: "obs.supervisor_cycle", component: "obs", ...summary });
    return summary;
  }
}

export function recentSupervisorCycles(limit = 10) {
  return recentCycles.slice(-limit);
}

export function supervisorState() {
  return { active_cycles: activeCycles, recent: recentSupervisorCycles(10) };
}

// ---- intervalo entre renovações por número --------------------------------

const lastRenewAt = new Map<string, number>();

export function recordLeaseRenewed(sessionName: string, ttlSeconds: number, at = Date.now()) {
  const previous = lastRenewAt.get(sessionName);
  lastRenewAt.set(sessionName, at);
  if (previous === undefined) return;
  const gap = at - previous;
  observer.max(sessionName, "renew_gap_ms", gap);
  observer.max(PROCESS_SESSION, "renew_gap_ms", gap);
  if (gap > (ttlSeconds * 1000) / 2) {
    observer.count(sessionName, "renew_late");
    observer.count(PROCESS_SESSION, "renew_late");
  }
}

export function forgetLease(sessionName: string) {
  lastRenewAt.delete(sessionName);
}

observer.registerGlobalProbe("event_loop", () => recentEventLoop());
observer.registerGlobalProbe("supervisor", () => supervisorState());
