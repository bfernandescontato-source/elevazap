import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ shopee: vi.fn(), amazon: vi.fn(), magalu: vi.fn(), ml: vi.fn(), info: vi.fn(), row: null as any }));
vi.mock("@/lib/supabase", () => ({ supabaseAdmin: () => ({ from: () => { const query: any = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: mocks.row }) }; return query; } }) }));
vi.mock("@/modules/piloto-link/server/service", () => ({ shopeeProductInfo: mocks.info }));
vi.mock("@/modules/affiliate-catalog/server/mercado-livre-link-service", () => ({ startMercadoLivreAffiliateLink: mocks.ml }));
vi.mock("@/modules/affiliate-catalog/server/store-link-service", async () => {
  class StoreLinkError extends Error { constructor(message: string, readonly status = 422) { super(message); } }
  return { StoreLinkError, shopeeAffiliateLink: mocks.shopee, amazonAffiliateLink: mocks.amazon, magaluAffiliateLink: mocks.magalu };
});
import { resolveListLink } from "../modules/affiliate-catalog/server/link-list-service";
import { StoreLinkError } from "@/modules/affiliate-catalog/server/store-link-service";

const db = {} as any;
beforeEach(() => { vi.clearAllMocks(); mocks.row = null; mocks.info.mockResolvedValue(null); });

describe("lista de links: conversão por loja", () => {
  it("Shopee: link afiliado da conta e dados pela API", async () => {
    mocks.shopee.mockResolvedValue("https://s.shopee.com.br/meu");
    mocks.info.mockResolvedValue({ productName: "Fone X", price: "89.9", imageUrl: "https://cf.shopee.com.br/a.jpg" });
    const result = await resolveListLink(db, "acc", "http://shopee.com.br/Fone-X-i.12.34?sp_atk=1");
    expect(mocks.shopee).toHaveBeenCalledWith(db, "acc", "https://shopee.com.br/product/12/34");
    expect(result).toMatchObject({ status: "ready", missingInfo: false, offer: { provider: "SHOPEE", externalItemId: "34", name: "Fone X", priceMin: 89.9, affiliateUrl: "https://s.shopee.com.br/meu" } });
  });

  it("Magazine Luiza vira link da Magazine Você", async () => {
    mocks.magalu.mockResolvedValue("https://www.magazinevoce.com.br/magazineana/smart-tv-50/p/abc123456/");
    const result = await resolveListLink(db, "acc", "https://www.magazineluiza.com.br/smart-tv-50/p/abc123456/et/tv/");
    expect(mocks.magalu).toHaveBeenCalledWith(db, "acc", "https://www.magazinevoce.com.br/magazinevoce/smart-tv-50/p/abc123456/");
    expect(result).toMatchObject({ status: "ready", missingInfo: true, offer: { externalItemId: "abc123456", name: "Smart tv 50" } });
  });

  it("Amazon: ASIN sai do link convertido e os dados do catálogo coletado", async () => {
    mocks.amazon.mockResolvedValue("https://amazon.com.br/dp/B0ABCDEFGH?tag=minha-20");
    mocks.row = { name: "Kindle", price: 499, original_price: 599 };
    const result = await resolveListLink(db, "acc", "https://amzn.to/abc");
    expect(result).toMatchObject({ status: "ready", offer: { externalItemId: "B0ABCDEFGH", name: "Kindle", priceMin: 499, originalPrice: 599 } });
  });

  it("Mercado Livre pela extensão fica pendente com o job", async () => {
    mocks.ml.mockResolvedValue({ status: "pending", jobId: "job-1" });
    const result = await resolveListLink(db, "acc", "https://www.mercadolivre.com.br/creatina-pura/p/MLB18725310?matt_tool=1");
    expect(mocks.ml).toHaveBeenCalledWith(db, "acc", "https://www.mercadolivre.com.br/creatina-pura/p/MLB18725310", "MLB18725310");
    expect(result).toMatchObject({ status: "pending", jobId: "job-1", offer: { name: "Creatina pura" } });
  });

  it("motivos simples de erro", async () => {
    mocks.ml.mockRejectedValue(new Error("MERCADO_LIVRE_EXTENSION_NOT_CONNECTED"));
    expect(await resolveListLink(db, "acc", "https://produto.mercadolivre.com.br/MLB-123456789-fone-_JM")).toMatchObject({ status: "error", error: "Mercado Livre não conectado. Conecte no Piloto Automático." });
    mocks.shopee.mockRejectedValue(new StoreLinkError("x", 409));
    expect(await resolveListLink(db, "acc", "https://shopee.com.br/product/1/2")).toMatchObject({ status: "error", error: "Shopee não conectada. Conecte em Integrações." });
    expect(await resolveListLink(db, "acc", "https://example.com/produto")).toMatchObject({ status: "error", error: "Link não reconhecido. Use Shopee, Mercado Livre, Amazon ou Magalu." });
    expect(await resolveListLink(db, "acc", "https://shopee.com.br/flash_sale")).toMatchObject({ status: "error", error: expect.stringContaining("Não achamos o produto") });
  });
});
