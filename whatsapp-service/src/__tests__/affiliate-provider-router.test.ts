import { describe, expect, it } from "vitest";
import { AffiliateProviderRouter } from "../offers/affiliate-provider-router.js";
import type { AffiliateProvider } from "../offers/affiliate-provider.js";

function provider(name: "shopee" | "mercado_livre", hostname: string): AffiliateProvider {
  return {
    name,
    supports: (value) => new URL(value).hostname === hostname,
    resolveUrl: async (value) => ({ provider: name, originalUrl: value, resolvedUrl: value }),
    generateAffiliateLink: async (product) => ({ ...product, affiliateLink: "https://example.invalid/affiliate" })
  };
}

describe("AffiliateProviderRouter", () => {
  const router = new AffiliateProviderRouter([provider("shopee", "s.shopee.com.br"), provider("mercado_livre", "meli.la")]);

  it("escolhe o provider de cada URL sem if espalhado", () => {
    expect(router.getProvider("https://s.shopee.com.br/abc").name).toBe("shopee");
    expect(router.getProvider("https://meli.la/abc").name).toBe("mercado_livre");
  });

  it("rejeita marketplace não suportado", () => {
    expect(() => router.getProvider("https://example.com/item")).toThrow("Marketplace não suportado");
  });
});
