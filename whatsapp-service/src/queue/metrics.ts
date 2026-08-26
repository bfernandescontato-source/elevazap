import type { QueueItem } from "./types.js";

export class QueueMetrics {
  private processed = 0;
  private succeeded = 0;
  private failed = 0;
  private uncertain = 0;
  private lastClaimAt: string | null = null;
  private lastProcessedAt: string | null = null;
  private lastError: string | null = null;
  private readonly startedAt = new Date().toISOString();

  claim() { this.lastClaimAt = new Date().toISOString(); }
  success() { this.processed += 1; this.succeeded += 1; this.lastProcessedAt = new Date().toISOString(); this.lastError = null; }
  failure(error: unknown) { this.processed += 1; this.failed += 1; this.lastProcessedAt = new Date().toISOString(); this.lastError = message(error); }
  uncertainResult(error: unknown) { this.processed += 1; this.uncertain += 1; this.lastProcessedAt = new Date().toISOString(); this.lastError = message(error); }
  loopError(error: unknown) { this.lastError = message(error); }

  snapshot(running: boolean, buffer: QueueItem[], reconciliation: number, activeSessions = 0) {
    return {
      running,
      size: buffer.length,
      reconciliation,
      activeSessions,
      highPriority: buffer.filter((item) => item.priority === "alta").length,
      normalPriority: buffer.filter((item) => item.priority === "normal").length,
      processed: this.processed,
      succeeded: this.succeeded,
      failed: this.failed,
      uncertain: this.uncertain,
      lastClaimAt: this.lastClaimAt,
      lastProcessedAt: this.lastProcessedAt,
      lastError: this.lastError,
      startedAt: this.startedAt
    };
  }
}

function message(error: unknown) {
  return error instanceof Error ? error.message : "Falha desconhecida na fila.";
}
