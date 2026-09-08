import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("backlog do Piloto Automático", () => {
  const processor = readFileSync(resolve(process.cwd(), "src/offers/offer-processor.ts"), "utf8");

  it("não descarta novas ofertas por capacidade", () => {
    expect(processor).not.toContain("offer_ignored_queue_full");
    expect(processor).not.toContain("queueAdmissionRejection");
    expect(processor).toContain('rpc("schedule_pilot_offer"');
  });
});
