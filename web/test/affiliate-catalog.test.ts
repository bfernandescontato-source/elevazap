import { describe, expect, it } from "vitest";
import { normalizeShopeeOffer } from "../modules/affiliate-catalog/server/shopee-provider";
import { MercadoLivreAffiliateProvider, normalizeMercadoLivreOffer } from "../modules/affiliate-catalog/server/mercado-livre-provider";
import { normalizeMercadoLivreProductUrl } from "../modules/affiliate-catalog/server/mercado-livre-link-service";

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
  it("normaliza Mercado Livre e omite comissão e avaliação ausentes", () => {
    const offer = normalizeMercadoLivreOffer({ id: "MLB123", title: "Produto ML", price: 80, original_price: 100, permalink: "https://produto.mercadolivre.com.br/MLB-123", thumbnail: "http://http2.mlstatic.com/x-I.jpg" });
    expect(offer).toMatchObject({ provider: "MERCADO_LIVRE", externalItemId: "MLB123", priceMin: 80, originalPrice: 100, discountPercentage: 20 });
    expect(offer.commissionAmount).toBeUndefined(); expect(offer.rating).toBeUndefined(); expect(offer.affiliateUrl).toBeUndefined();
  });
  it("usa tendências e busca oficiais do MLB para melhor performance", async () => {
    const calls: string[] = [];
    const fetcher = (async (input: URL | RequestInfo) => { const url=String(input); calls.push(url); return new Response(JSON.stringify(url.includes("/trends/")?[{keyword:"fone bluetooth"}]:{results:[{id:"MLB1",title:"Fone",price:99,permalink:"https://produto.mercadolivre.com.br/MLB-1"}],paging:{total:1,offset:0,limit:20}}),{status:200}); }) as typeof fetch;
    const result = await new MercadoLivreAffiliateProvider("token-mercado-livre-valido", fetcher).searchProducts({ listing:"top", page:1, limit:20 });
    expect(calls[0]).toContain("/trends/MLB"); expect(calls[1]).toContain("q=fone+bluetooth"); expect(result.offers[0].provider).toBe("MERCADO_LIVRE");
  });
  it("aceita somente URL oficial de produto para gerar afiliado", () => {
    expect(normalizeMercadoLivreProductUrl("https://produto.mercadolivre.com.br/MLB-1?utm_source=x")).toBe("https://produto.mercadolivre.com.br/MLB-1");
    expect(() => normalizeMercadoLivreProductUrl("https://exemplo.com/MLB-1")).toThrow("MERCADO_LIVRE_INVALID_URL");
  });
});
