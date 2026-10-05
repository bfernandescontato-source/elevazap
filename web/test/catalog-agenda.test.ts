import { describe, expect, it } from "vitest";
import { addDays, brasiliaDate, brasiliaInstant, brasiliaTime, everyInterval, sameTimeTomorrow, spreadAcrossDays, spreadInDay } from "../modules/affiliate-catalog/schedule-plan";
import { buildCatalogOfferMessage, catalogMessageRandom } from "../modules/affiliate-catalog/offer-message";
import { agendaCancelSchema, bulkScheduleSchema } from "../modules/affiliate-catalog/schemas";

const times = (dates: Date[] | null) => (dates || []).map(brasiliaTime);
const offer = { provider: "SHOPEE" as const, externalItemId: "1", name: "Fone Bluetooth X", priceMin: 89.9, affiliateUrl: "https://s.shopee.com.br/abc" };

describe("agenda do catálogo — horários", () => {
  it("usa o dia de Brasília mesmo perto da meia-noite UTC", () => {
    expect(brasiliaDate(new Date("2026-09-26T02:30:00Z"))).toBe("2026-09-25");
    expect(addDays("2026-09-30", 1)).toBe("2026-10-01");
  });

  it("espalha um dia futuro entre 07h e 22h como o Motor Mercado", () => {
    const now = new Date("2026-09-25T15:00:00-03:00");
    expect(times(spreadInDay(4, "2026-09-26", now))).toEqual(["10:00", "13:00", "16:00", "19:00"]);
  });

  it("para hoje começa em agora + 5 minutos e para às 22h", () => {
    const now = new Date("2026-09-25T20:00:00-03:00");
    const slots = spreadInDay(3, "2026-09-25", now)!;
    expect(slots[0].getTime()).toBeGreaterThan(brasiliaInstant("2026-09-25", "20:05").getTime());
    expect(slots[2].getTime()).toBeLessThan(brasiliaInstant("2026-09-25", "22:00").getTime());
  });

  it("recusa hoje depois das 22h", () => {
    expect(spreadInDay(2, "2026-09-25", new Date("2026-09-25T22:10:00-03:00"))).toBeNull();
  });

  it("intervalo fixo não agenda no passado", () => {
    const now = new Date("2026-09-25T10:00:00-03:00");
    expect(times(everyInterval(3, "2026-09-25", "08:00", 30, now))).toEqual(["10:05", "10:35", "11:05"]);
    expect(times(everyInterval(2, "2026-09-26", "08:00", 45, now))).toEqual(["08:00", "08:45"]);
  });

  it("redistribui entre dias mantendo a ordem", () => {
    const now = new Date("2026-09-25T06:00:00-03:00");
    const slots = spreadAcrossDays(5, "2026-09-25", 2, now)!;
    expect(slots.map(slot => brasiliaDate(slot))).toEqual(["2026-09-25", "2026-09-25", "2026-09-25", "2026-09-26", "2026-09-26"]);
    expect(brasiliaTime(sameTimeTomorrow(slots[0]))).toBe(brasiliaTime(slots[0]));
  });
});

describe("agenda do catálogo — mensagem automática", () => {
  it("monta De/Por com o preço antigo riscado e o link afiliado", () => {
    const message = buildCatalogOfferMessage({ ...offer, originalPrice: 179.8 }, offer.affiliateUrl, () => 0);
    expect(message).toContain("😱🔻50% DE DESCONTO");
    expect(message).toContain("❌ De: ~R$179,80~");
    expect(message).toContain("✅ Por: R$89,90");
    expect(message).toContain("🛒 https://s.shopee.com.br/abc");
  });

  it("sem preço antigo nem desconto real, mostra só o preço (nunca 0%)", () => {
    const message = buildCatalogOfferMessage({ ...offer, originalPrice: 90, discountPercentage: 0 }, offer.affiliateUrl, () => 0);
    expect(message).toContain("💰 Por apenas R$89,90");
    expect(message).not.toContain("DE DESCONTO");
  });

  it("limita o agendamento em massa a 10 ofertas por chamada", () => {
    const item = { offer, scheduledAt: "2026-09-26T10:00:00-03:00" };
    const base = { senderId: "00000000-0000-4000-8000-000000000000", groupJids: ["1@g.us"] };
    expect(bulkScheduleSchema.safeParse({ ...base, items: Array(10).fill(item) }).success).toBe(true);
    expect(bulkScheduleSchema.safeParse({ ...base, items: Array(11).fill(item) }).success).toBe(false);
  });
});

describe("prévia da mensagem e tirar da fila", () => {
  it("a prévia e o agendamento sorteiam o mesmo gancho para o produto no dia", () => {
    const preview = buildCatalogOfferMessage(offer, offer.affiliateUrl, catalogMessageRandom(offer, "2026-10-06"));
    const sent = buildCatalogOfferMessage(offer, offer.affiliateUrl, catalogMessageRandom(offer, brasiliaDate(new Date("2026-10-06T15:40:00-03:00"))));
    expect(sent).toBe(preview);
  });

  it("o gancho varia entre produtos e dias e fica entre 0 e 1", () => {
    const hooks = new Set<string>();
    for (let day = 1; day <= 20; day++) hooks.add(buildCatalogOfferMessage(offer, offer.affiliateUrl, catalogMessageRandom(offer, `2026-10-${String(day).padStart(2, "0")}`)).split("\n")[0]);
    expect(hooks.size).toBeGreaterThan(3);
    const random = catalogMessageRandom({ provider: "MERCADO_LIVRE", externalItemId: "MLB123" }, "2026-10-06");
    for (let i = 0; i < 1000; i++) { const value = random(); expect(value).toBeGreaterThanOrEqual(0); expect(value).toBeLessThan(1); }
  });

  it("a prévia do Mercado Livre mostra o marcador no lugar do link", () => {
    const message = buildCatalogOfferMessage({ ...offer, provider: "MERCADO_LIVRE", affiliateUrl: undefined }, "[seu link de afiliado]", catalogMessageRandom(offer, "2026-10-06"));
    expect(message).toContain("[seu link de afiliado]");
  });

  it("tirar da fila aceita uma oferta ou várias (até 200)", () => {
    const id = "6f1c2b0e-8a7d-4c3b-9e2f-1a2b3c4d5e6f";
    expect(agendaCancelSchema.safeParse({ id }).success).toBe(true);
    expect(agendaCancelSchema.safeParse({ ids: [id, id] }).success).toBe(true);
    expect(agendaCancelSchema.safeParse({ ids: [] }).success).toBe(false);
    expect(agendaCancelSchema.safeParse({ ids: Array(201).fill(id) }).success).toBe(false);
    expect(agendaCancelSchema.safeParse({ ids: ["nao-e-uuid"] }).success).toBe(false);
  });
});
