import { describe, expect, it } from "vitest";
import { QueueMetrics } from "../queue/metrics.js";

describe("métricas da fila", () => {
  it("contabiliza resultados sem expor dados dos jobs", () => {
    const metrics = new QueueMetrics();
    metrics.claim();
    metrics.success();
    metrics.failure(new Error("falha controlada"));
    metrics.uncertainResult(new Error("resultado incerto"));
    const snapshot = metrics.snapshot(true, [
      { id: "1", kind: "envio", priority: "alta", claim_token: "a" },
      { id: "2", kind: "grupo", priority: "normal", claim_token: "b" }
    ], 1);
    expect(snapshot).toMatchObject({ running: true, size: 2, processed: 3, succeeded: 1, failed: 1, uncertain: 1, reconciliation: 1 });
    expect(snapshot).not.toHaveProperty("jobs");
  });

  it("registra falha do loop sem contabilizar envio", () => {
    const metrics = new QueueMetrics();
    metrics.loopError(new Error("banco indisponível"));
    expect(metrics.snapshot(true, [], 0)).toMatchObject({ processed: 0, lastError: "banco indisponível" });
  });
});
