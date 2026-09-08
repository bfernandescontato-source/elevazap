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

  it("preserva um backlog que passa de sete dias", () => {
    const now = new Date("2026-08-26T20:30:00Z");
    const staleFuture = new Date("2026-09-04T22:30:00Z");
    const next = nextOfferSlot(schedule, now, staleFuture);
    expect(next.toISOString()).toBe("2026-09-04T23:00:00.000Z");
  });

  it.each([5, 10, 15])("mantém intervalo de %i minutos em um pico com mais de cinco ofertas", (intervalMinutes) => {
    const currentSchedule = { ...schedule, intervalMinutes, operatingStart: "00:00", operatingEnd: "23:59" };
    const now = new Date("2026-08-14T13:00:00Z");
    const slots: Date[] = [];
    for (let index = 0; index < 12; index += 1) {
      slots.push(nextOfferSlot(currentSchedule, now, slots.at(-1)));
    }
    expect(slots).toHaveLength(12);
    for (let index = 1; index < slots.length; index += 1) {
      expect(slots[index].getTime() - slots[index - 1].getTime()).toBe(intervalMinutes * 60_000);
    }
  });
});
