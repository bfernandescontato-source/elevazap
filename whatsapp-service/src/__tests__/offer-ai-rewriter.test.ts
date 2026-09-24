import { describe, expect, it } from "vitest";
import { OfferAiRewriter, sanitizeSourcePromotion, verifyExtractedOffer } from "../offers/offer-ai-rewriter.js";
import { DISCOUNT_HOOKS, GENERAL_HOOKS, OFFER_DISCLAIMER, buildOfferCopy, discountPercent, parseBrlPrice } from "../offers/offer-copy-template.js";
import { normalizeWhatsappOfferText } from "../offers/whatsapp-copy.js";

const link = "https://s.shopee.com.br/6L4VMELiYK";
const extracted = (overrides: Record<string, unknown> = {}) => ({
  product_name: "Castanha de Caju 1Kg (Com ou sem Sal) - P&P",
  price_from: "R$ 89,35",
  price_to: "R$ 58,97",
  price_condition: null,
  discount_percent: null,
  coupon: null,
  extra_lines: [],
  ...overrides
}) as never;
const firstHook = () => 0;

function clientReturning(facts: unknown) {
  return { responses: { create: async () => ({ status: "completed", output_text: JSON.stringify(facts) }) } } as never;
}

describe("copy da oferta no modelo fixo", () => {
  it("monta o modelo com desconto igual ao aprovado", async () => {
    const original = `🔥 Castanha de Caju 1Kg (Com ou sem Sal) - P&P\nDe R$ 89,35 por R$ 58,97\n${link}`;
    const result = await new OfferAiRewriter(undefined, "gpt-test", clientReturning(extracted()), firstHook).rewrite({ text: original, purchaseLink: link, links: [] });
    expect(result.text).toBe([
      "CORRE QUE ACABA ⚡️",
      "",
      "🛍️ Castanha de Caju 1Kg (Com ou sem Sal) - P&P",
      "",
      "😱🔻34% DE DESCONTO",
      "De: R$89,35",
      "Por: R$58,97 ✅",
      "",
      "COMPRE AQUI 👇",
      `🛒 ${link}`,
      "",
      OFFER_DISCLAIMER
    ].join("\n"));
    expect(normalizeWhatsappOfferText(result.text)).toBe(result.text);
  });

  it("sem preço antigo não mostra desconto e só usa gancho geral", () => {
    const text = buildOfferCopy({ productName: "Fone Bluetooth", priceFromCents: null, priceToCents: 5500, priceCondition: null, statedDiscountPercent: null, coupon: null, extraLines: [] }, link, () => 0.99);
    expect(text).toContain("💰 Por apenas R$55,00 ✅");
    expect(text).not.toMatch(/DESCONTO|De:/);
    expect(GENERAL_HOOKS).toContain(text.split("\n")[0]);
  });

  it("esconde desconto abaixo de 5% ou quando o preço antigo não é maior", () => {
    expect(discountPercent(10000, 9700)).toBeNull();
    expect(discountPercent(9000, 9000)).toBeNull();
    expect(discountPercent(9000, 9500)).toBeNull();
    expect(discountPercent(10000, 9500)).toBe(5);
    expect(discountPercent(8935, 5897)).toBe(34);
  });

  it("sorteia ganchos de desconto só quando há desconto", () => {
    const hooks = new Set<string>();
    for (let i = 0; i < 20; i++) {
      hooks.add(buildOfferCopy({ productName: "X", priceFromCents: 10000, priceToCents: 5000, priceCondition: null, statedDiscountPercent: null, coupon: null, extraLines: [] }, link, () => i / 20).split("\n")[0]);
    }
    expect([...hooks].some((hook) => DISCOUNT_HOOKS.includes(hook))).toBe(true);
    for (let i = 0; i < 10; i++) {
      const hook = buildOfferCopy({ productName: "X", priceFromCents: null, priceToCents: 5000, priceCondition: null, statedDiscountPercent: null, coupon: null, extraLines: [] }, link, () => i / 10).split("\n")[0];
      expect(DISCOUNT_HOOKS).not.toContain(hook);
    }
  });

  it("desconto pequeno (abaixo de 20%) aparece, mas sem gancho de desconto forte", () => {
    for (let i = 0; i < 20; i++) {
      const text = buildOfferCopy({ productName: "Cesta para Ovos", priceFromCents: 3090, priceToCents: 2789, priceCondition: null, statedDiscountPercent: null, coupon: null, extraLines: [] }, link, () => i / 20);
      expect(text).toContain("9% DE DESCONTO");
      expect(DISCOUNT_HOOKS).not.toContain(text.split("\n")[0]);
    }
  });

  it("mantém recorrência e cupom em blocos próprios", () => {
    const original = "Fralda Pampers Pants M 124 Tiras\nR$ 141,82\nSelecione Programe e Poupe\nComprando 5 unidades: R$ 134,73 cada\nCupom: FRALDA10";
    const facts = verifyExtractedOffer(original, extracted({
      product_name: "Fralda Pampers Pants M 124 Tiras", price_from: null, price_to: "141,82", coupon: "FRALDA10",
      extra_lines: ["Selecione Programe e Poupe", "Comprando 5 unidades: R$ 134,73 cada", "Comprando 10 unidades: R$ 99,00 cada"]
    }));
    expect(facts.extraLines).toEqual(["Selecione Programe e Poupe", "Comprando 5 unidades: R$ 134,73 cada"]);
    const text = buildOfferCopy(facts, link, firstHook);
    expect(text).toContain("✨ Aproveite também:\n▪️ Selecione Programe e Poupe\n▪️ Comprando 5 unidades: R$ 134,73 cada");
    expect(text).toContain("🎟️ Use o cupom: FRALDA10");
  });

  it("mostra a condição de pagamento junto do preço", () => {
    const facts = verifyExtractedOffer("Toalhas por R$ 110,91 no pix", extracted({ price_from: null, price_to: "110,91", price_condition: "no pix" }));
    expect(buildOfferCopy(facts, link, firstHook)).toContain("💰 Por apenas R$110,91 no pix ✅");
    expect(verifyExtractedOffer("Toalhas por R$ 110,91", extracted({ price_from: null, price_to: "110,91", price_condition: "no Pix" })).priceCondition).toBeNull();
  });

  it("usa o percentual escrito na oferta quando não há preço antigo", () => {
    const facts = verifyExtractedOffer("Condicionador R$ 22,29 (50% off)", extracted({ price_from: null, price_to: "22,29", discount_percent: 50 }));
    expect(buildOfferCopy(facts, link, firstHook)).toContain("😱🔻50% DE DESCONTO\nPor: R$22,29 ✅");
    expect(verifyExtractedOffer("Condicionador R$ 22,29", extracted({ price_from: null, price_to: "22,29", discount_percent: 50 })).statedDiscountPercent).toBeNull();
  });

  it("coloca R$ em valores soltos das linhas extras", () => {
    const facts = verifyExtractedOffer("Proteína R$ 29,90 e 26,91 na recorrência, 5 unidades R$ 1.134,73", extracted({
      price_from: null, price_to: "29,90", extra_lines: ["26,91 na recorrência", "5 unidades: R$ 1.134,73"]
    }));
    expect(facts.extraLines).toEqual(["R$ 26,91 na recorrência", "5 unidades: R$ 1.134,73"]);
  });

  it("só aceita cupom que é código de verdade", () => {
    const original = "Produto R$ 49,99 Use o cupom: RESGATE O CUPOM DE R$20 OFF";
    expect(verifyExtractedOffer(original, extracted({ price_from: null, price_to: "49,99", coupon: "RESGATE O CUPOM DE R$20 OFF" })).coupon).toBeNull();
    expect(verifyExtractedOffer("Produto R$ 49,99 cupom FRALDA10", extracted({ price_from: null, price_to: "49,99", coupon: "FRALDA10" })).coupon).toBe("FRALDA10");
  });

  it("rejeita preço que não está na oferta original e ignora cupom inventado", () => {
    expect(() => verifyExtractedOffer("Produto por R$ 49,99", extracted({ price_from: null, price_to: "39,99" }))).toThrow(/preço/);
    expect(verifyExtractedOffer("Produto por R$ 49,99", extracted({ price_from: null, price_to: "49,99", coupon: "INVENTADO" })).coupon).toBeNull();
  });

  it("lê preços em vários formatos", () => {
    expect(parseBrlPrice("R$ 1.299,90")).toBe(129990);
    expect(parseBrlPrice("89,35")).toBe(8935);
    expect(parseBrlPrice("55")).toBe(5500);
    expect(parseBrlPrice(null)).toBeNull();
  });

  it("sem link de compra não monta copy", async () => {
    await expect(new OfferAiRewriter(undefined, "gpt-test", clientReturning(extracted())).rewrite({ text: "x", purchaseLink: null, links: [] })).rejects.toThrow(/link/);
  });

  it("remove deterministicamente a divulgação do grupo fonte", () => {
    const aff = "https://s.shopee.com.br/5LB6yUc6Fe?lp=aff";
    const original = `🛍️ Short linho feminino\n\n🔥 Por: R$ 69,99\n\n🔗 Link de compra:\n${aff}\n\n💖 Nos siga no instagram @achadosdadianadiniz; @achadosdadim e chame suas amigas: https://achadosdadianadiniz.com.br/`;
    const sanitized = sanitizeSourcePromotion(original, aff);
    expect(sanitized).toContain("R$ 69,99");
    expect(sanitized).toContain(aff);
    expect(sanitized).not.toMatch(/instagram|@achados|achadosdadianadiniz\.com/i);
  });
});
