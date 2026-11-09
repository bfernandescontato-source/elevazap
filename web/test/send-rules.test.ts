import { describe, expect, it } from "vitest";
import { isInQuietHours, productKey, repeatedGroups, sendRulesSchema, shiftOutOfQuietHours } from "../modules/send-guard/rules";

const night = { quietHoursEnabled: true, quietStart: "22:00", quietEnd: "06:00" };
const at = (local: string) => new Date(`${local}-03:00`);
const iso = (date: Date) => date.toISOString();

describe("pausa noturna", () => {
  it("desligada não muda nada", () => {
    const when = at("2026-11-06T23:30:00");
    expect(shiftOutOfQuietHours(when, { ...night, quietHoursEnabled: false })).toBe(when);
  });

  it("janela que cruza a meia-noite: noite vai para as 06:00 do dia seguinte", () => {
    expect(iso(shiftOutOfQuietHours(at("2026-11-06T22:00:00"), night))).toBe(iso(at("2026-11-07T06:00:00")));
    expect(iso(shiftOutOfQuietHours(at("2026-11-06T23:59:00"), night))).toBe(iso(at("2026-11-07T06:00:00")));
  });

  it("madrugada vai para as 06:00 do mesmo dia", () => {
    expect(iso(shiftOutOfQuietHours(at("2026-11-07T00:00:00"), night))).toBe(iso(at("2026-11-07T06:00:00")));
    expect(iso(shiftOutOfQuietHours(at("2026-11-07T05:59:30"), night))).toBe(iso(at("2026-11-07T06:00:00")));
  });

  it("fora da pausa fica igual (início entra, fim não)", () => {
    for (const local of ["2026-11-07T06:00:00", "2026-11-07T12:00:00", "2026-11-06T21:59:00"]) {
      const when = at(local);
      expect(shiftOutOfQuietHours(when, night).getTime()).toBe(when.getTime());
      expect(isInQuietHours(when, night)).toBe(false);
    }
    expect(isInQuietHours(at("2026-11-06T22:00:00"), night)).toBe(true);
  });

  it("vira o mês e o ano", () => {
    expect(iso(shiftOutOfQuietHours(at("2026-12-31T23:10:00"), night))).toBe(iso(at("2027-01-01T06:00:00")));
  });

  it("janela no mesmo dia (13:00 às 14:30)", () => {
    const lunch = { quietHoursEnabled: true, quietStart: "13:00", quietEnd: "14:30" };
    expect(iso(shiftOutOfQuietHours(at("2026-11-06T13:45:00"), lunch))).toBe(iso(at("2026-11-06T14:30:00")));
    expect(shiftOutOfQuietHours(at("2026-11-06T14:30:00"), lunch).getTime()).toBe(at("2026-11-06T14:30:00").getTime());
    expect(shiftOutOfQuietHours(at("2026-11-06T23:00:00"), lunch).getTime()).toBe(at("2026-11-06T23:00:00").getTime());
  });

  it("usa o fuso de Brasília mesmo com horário UTC de outro dia", () => {
    // 01:30 UTC do dia 7 = 22:30 do dia 6 em Brasília
    expect(iso(shiftOutOfQuietHours(new Date("2026-11-07T01:30:00Z"), night))).toBe(iso(at("2026-11-07T06:00:00")));
  });

  it("valida início diferente do fim e dias de 0 a 30", () => {
    expect(sendRulesSchema.safeParse({ ...night, productRepeatDays: 3 }).success).toBe(true);
    expect(sendRulesSchema.safeParse({ ...night, quietEnd: "22:00", productRepeatDays: 3 }).success).toBe(false);
    expect(sendRulesSchema.safeParse({ ...night, productRepeatDays: 31 }).success).toBe(false);
    expect(sendRulesSchema.safeParse({ ...night, quietStart: "24:00", productRepeatDays: 0 }).success).toBe(false);
  });
});

describe("produto repetido", () => {
  it("monta a chave igual ao banco", () => {
    expect(productKey("shopee", " 123 ")).toBe("SHOPEE:123");
    expect(productKey("MERCADO_LIVRE", "mlb999")).toBe("MERCADO_LIVRE:MLB999");
    expect(productKey("mercado_livre", "MLB999")).toBe(productKey("MERCADO_LIVRE", "MLB999"));
    expect(productKey("multiple", "1")).toBeNull();
    expect(productKey("SHOPEE", null)).toBeNull();
    expect(productKey(null, "1")).toBeNull();
  });

  const key = "SHOPEE:1";
  const when = at("2026-11-06T12:00:00");
  const row = (group_jid: string, scheduled: string, status = "sucesso", product_key: string | null = key) =>
    ({ group_jid, product_key, status, scheduled_at: iso(at(scheduled)) });

  it("bloqueia o grupo que recebeu o produto dentro do prazo", () => {
    const history = [row("a@g.us", "2026-11-04T12:00:01"), row("b@g.us", "2026-11-03T11:00:00")];
    expect([...repeatedGroups(history, key, ["a@g.us", "b@g.us", "c@g.us"], when, 2)]).toEqual(["a@g.us"]);
  });

  it("também bloqueia quando o mesmo produto já está agendado para depois", () => {
    expect(repeatedGroups([row("a@g.us", "2026-11-07T09:00:00", "pendente")], key, ["a@g.us"], when, 3).has("a@g.us")).toBe(true);
  });

  it("envio com erro, cancelado ou de outro produto não conta", () => {
    const history = [row("a@g.us", "2026-11-06T08:00:00", "erro"), row("a@g.us", "2026-11-06T08:00:00", "cancelado"), row("a@g.us", "2026-11-06T08:00:00", "sucesso", "SHOPEE:2")];
    expect(repeatedGroups(history, key, ["a@g.us"], when, 3).size).toBe(0);
  });

  it("0 dias ou produto sem chave desliga a regra", () => {
    const history = [row("a@g.us", "2026-11-06T08:00:00")];
    expect(repeatedGroups(history, key, ["a@g.us"], when, 0).size).toBe(0);
    expect(repeatedGroups(history, null, ["a@g.us"], when, 3).size).toBe(0);
  });
});
