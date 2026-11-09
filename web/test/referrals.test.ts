import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  extractReferralCodeFromHubla,
  generateReferralCode,
  isValidReferralCode,
  normalizeReferralCode,
  referralLink,
  rewardForPayingCount,
  summarizeReferrals,
  withReferralSrc,
} from "../modules/referrals/rules";

vi.mock("@/lib/supabase", () => ({ supabaseAdmin: () => { throw new Error("não usar no teste"); } }));

const fixture = () => JSON.parse(readFileSync(resolve(__dirname, "fixtures/hubla-invoice-payment-succeeded.json"), "utf8"));

describe("recompensa do indique e ganhe", () => {
  it("paga R$ 25 a cada 5 pagantes", () => {
    for (const count of [0, 1, 2, 3, 4]) expect(rewardForPayingCount(count)).toBe(0);
    expect(rewardForPayingCount(5)).toBe(2500);
    expect(rewardForPayingCount(9)).toBe(2500);
    expect(rewardForPayingCount(10)).toBe(5000);
    expect(rewardForPayingCount(12)).toBe(5000);
    expect(rewardForPayingCount(-3)).toBe(0);
  });

  it("reembolso tira o indicado da contagem", () => {
    const five = summarizeReferrals(["paying", "paying", "paying", "paying", "paying"], []);
    expect(five.earnedCents).toBe(2500);
    const refunded = summarizeReferrals(["paying", "paying", "paying", "paying", "refunded"], []);
    expect(refunded.payingCount).toBe(4);
    expect(refunded.earnedCents).toBe(0);
    expect(refunded.remainingForNext).toBe(1);
  });

  it("saldo a receber = ganho - já pago, nunca negativo", () => {
    const statuses = Array(12).fill("paying");
    expect(summarizeReferrals(statuses, [2500])).toMatchObject({ earnedCents: 5000, paidOutCents: 2500, balanceCents: 2500, progressInBlock: 2 });
    expect(summarizeReferrals(statuses.slice(0, 4), [2500]).balanceCents).toBe(0);
    expect(summarizeReferrals(["pending", "paying"], []).payingCount).toBe(1);
  });
});

describe("código de indicação", () => {
  it("gera nome + 2 dígitos sem acento", () => {
    expect(generateReferralCode("João da Silva", 0, () => 0.07)).toBe("JOAO07");
    expect(generateReferralCode("Maria Aparecida", 0, () => 0.5)).toBe("MARIA50");
    expect(generateReferralCode("Bartholomeuzinho", 0, () => 0)).toBe("BARTHOLO00");
  });

  it("usa 6 caracteres quando não há nome ou após várias colisões", () => {
    const random = generateReferralCode("", 0);
    expect(random).toMatch(/^[A-Z2-9]{6}$/);
    expect(generateReferralCode("Ana", 4)).toMatch(/^[A-Z2-9]{6}$/);
    expect(generateReferralCode("Ana", 2, () => 0.123)).toBe("ANA123");
  });

  it("todo código gerado é válido", () => {
    for (const name of ["Zé", "123", "Ícaro Souza", "x", null, "Ana-Paula"]) {
      for (let attempt = 0; attempt < 6; attempt += 1) expect(isValidReferralCode(generateReferralCode(name, attempt))).toBe(true);
    }
  });

  it("valida e normaliza", () => {
    expect(normalizeReferralCode(" joao07 ")).toBe("JOAO07");
    expect(normalizeReferralCode("ab")).toBeNull();
    expect(normalizeReferralCode("JOAO-07")).toBeNull();
    expect(normalizeReferralCode("A".repeat(13))).toBeNull();
    expect(normalizeReferralCode(42)).toBeNull();
  });

  it("monta link de indicação e checkout com src", () => {
    expect(referralLink("JOAO07")).toBe("https://www.disparei.pro/?ind=JOAO07");
    expect(withReferralSrc("https://pay.hub.la/ABC", "joao07")).toBe("https://pay.hub.la/ABC?src=ind_JOAO07");
    expect(withReferralSrc("https://pay.hub.la/ABC", null)).toBe("https://pay.hub.la/ABC");
    expect(withReferralSrc("https://pay.hub.la/ABC", "<script>")).toBe("https://pay.hub.la/ABC");
  });
});

describe("código no evento da Hubla", () => {
  it("lê params.src", () => {
    const body = fixture();
    body.event.invoice.paymentSession.params.src = "ind_JOAO07";
    expect(extractReferralCodeFromHubla(body)).toBe("JOAO07");
  });

  it("aceita utm.content e utm.source como reserva", () => {
    const body = fixture();
    body.event.invoice.paymentSession.utm.content = "IND_maria50";
    expect(extractReferralCodeFromHubla(body)).toBe("MARIA50");
    const other = fixture();
    other.event.invoice.paymentSession.utm.source = "ind_ana123";
    expect(extractReferralCodeFromHubla(other)).toBe("ANA123");
  });

  it("ignora src que não é de indicação", () => {
    expect(extractReferralCodeFromHubla(fixture())).toBeNull();
    expect(extractReferralCodeFromHubla({})).toBeNull();
    expect(extractReferralCodeFromHubla(null)).toBeNull();
    const body = fixture();
    body.event.invoice.paymentSession.params.src = "ind_x";
    expect(extractReferralCodeFromHubla(body)).toBeNull();
  });
});

describe("indicação no webhook", () => {
  it("nunca lança erro, mesmo com banco quebrado", async () => {
    const { recordHublaReferral } = await import("../modules/referrals/server/referral-webhook");
    const broken = { from: () => { throw new Error("banco fora"); } } as any;
    const body = fixture();
    body.event.invoice.paymentSession.params.src = "ind_JOAO07";
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(recordHublaReferral(broken, {
      body, eventType: "invoice.payment_succeeded", email: "a@b.com", account: { id: "x" }, accountCreated: true, idempotencyKey: "k",
    })).resolves.toBe("error");
    spy.mockRestore();
  });

  it("sem código não toca no banco", async () => {
    const { recordHublaReferral } = await import("../modules/referrals/server/referral-webhook");
    const from = vi.fn();
    await expect(recordHublaReferral({ from } as any, {
      body: fixture(), eventType: "invoice.payment_succeeded", email: "a@b.com", account: { id: "x" }, accountCreated: true, idempotencyKey: "k",
    })).resolves.toBe("no_code");
    expect(from).not.toHaveBeenCalled();
  });
});
