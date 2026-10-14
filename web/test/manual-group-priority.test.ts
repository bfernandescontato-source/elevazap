import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

describe("prioridade de disparos manuais para grupos", () => {
  it("marca campanhas e distribuições manuais como prioridade alta", () => {
    expect(read("web/app/api/lotes/create/route.ts")).toContain('priority: "high"');
    expect(read("web/app/api/lotes/bulk-schedule/route.ts")).toContain('priority: "high"');
    expect(read("web/modules/affiliate-catalog/server/catalog-dispatch-service.ts")).toContain('priority: "high"');
  });

  it("prioriza o lote manual e deixa de reabastecer lote automático ativo", () => {
    const migration = read("supabase/migrations/20261014190500_prioritize_manual_group_dispatches.sql");
    expect(migration).toContain("first_due.priority='high'");
    expect(migration).toContain("urgent.priority='high'");
    expect(migration).toContain("active_job.priority='normal'");
  });
});
