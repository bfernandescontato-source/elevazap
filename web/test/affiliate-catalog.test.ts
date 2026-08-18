import { describe, expect, it } from "vitest";
import { normalizeShopeeOffer } from "../modules/affiliate-catalog/server/shopee-provider";

describe("catálogo de afiliados", () => {
  it("normaliza a Shopee sem acoplar a UI ao provider", () => {
    const offer = normalizeShopeeOffer({ itemId: 123, productName: "Produto", priceMin: "99.90", priceMax: "109.90", priceDiscountRate: 20, commissionRate: "0.15", commission: "14.98", sales: 2500, offerLink: "https://s.shopee.com.br/x" });
    expect(offer).toMatchObject({ provider: "SHOPEE", externalItemId: "123", name: "Produto", priceMin: 99.9, commissionRate: 15, commissionAmount: 14.98, sales: 2500 });
    expect(offer.originalPrice).toBeCloseTo(124.875);
  });
  it("não inventa campos ausentes", () => {
    const offer = normalizeShopeeOffer({ itemId: 9, productName: "Sem métricas" });
    expect(offer.rating).toBeUndefined(); expect(offer.sales).toBeUndefined(); expect(offer.affiliateUrl).toBeUndefined();
  });
});
