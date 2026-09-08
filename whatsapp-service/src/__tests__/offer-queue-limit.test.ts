import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("backlog do Piloto Automático", () => {
  const processor = readFileSync(resolve(process.cwd(), "src/offers/offer-processor.ts"), "utf8");
  const migration = readFileSync(resolve(process.cwd(), "../supabase/migrations/20260908165112_definitive_pilot_waiting_queue.sql"), "utf8");

  it("não descarta novas ofertas por capacidade", () => {
    expect(processor).not.toContain("offer_ignored_queue_full");
    expect(processor).not.toContain("queueAdmissionRejection");
    expect(processor).toContain('rpc("schedule_pilot_offer"');
  });

  it("mantém no máximo cinco slots físicos e preserva excedentes em waiting", () => {
    expect(migration).toContain("v_slots >= 5");
    expect(migration).toContain("set status='waiting', scheduled_at=null");
    expect(migration).toContain("not exists (select 1 from public.offer_deliveries");
    expect(processor).toContain('result.status === "waiting"');
  });
});
