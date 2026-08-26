import { describe, expect, it } from "vitest";
import { nextOfferSlot } from "../offers/offer-scheduler.js";

const schedule = { intervalMinutes: 30, operatingStart: "07:30", operatingEnd: "22:30", timezone: "America/Sao_Paulo" };

describe("OfferScheduler", () => {
  it("ocupa slots de 30 minutos", () => {
    const first = nextOfferSlot(schedule, new Date("2026-08-14T13:00:00Z"));
    const second = nextOfferSlot(schedule, new Date("2026-08-14T13:00:00Z"), first);
    expect(first.toISOString()).toBe("2026-08-14T13:00:00.000Z");
    expect(second.toISOString()).toBe("2026-08-14T13:30:00.000Z");
  });

  it("continua às 07:30 do dia seguinte depois do slot 22:30", () => {
    const last = new Date("2026-08-15T01:30:00Z");
    const next = nextOfferSlot(schedule, last, last);
    expect(next.toISOString()).toBe("2026-08-15T10:30:00.000Z");
  });

  it("ignora uma referência antiga demais no futuro", () => {
    const now = new Date("2026-08-26T20:30:00Z");
    const staleFuture = new Date("2026-09-04T22:30:00Z");
    const next = nextOfferSlot(schedule, now, staleFuture);
    expect(next.toISOString()).toBe(now.toISOString());
  });
});
