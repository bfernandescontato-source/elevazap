import { describe, expect, it } from "vitest";
import { assertAllowedMercadoLivreUrl, extractMercadoLivreProductIdentifiers, sanitizeMercadoLivreProductUrl } from "../offers/mercado-livre-url-resolver.js";

describe("MercadoLivreUrlResolver", () => {
  it("aceita short link oficial", () => {
    expect(assertAllowedMercadoLivreUrl("https://meli.la/abc").hostname).toBe("meli.la");
  });

  it("identifica item e produto de catálogo", () => {
    expect(extractMercadoLivreProductIdentifiers("https://www.mercadolivre.com.br/produto/p/MLB18725310?pdp_filters=item_id%3AMLB6713010960"))
      .toEqual({ itemId: "MLB6713010960", catalogProductId: "MLB18725310" });
    expect(extractMercadoLivreProductIdentifiers("https://produto.mercadolivre.com.br/MLB-4049279695-produto-_JM"))
      .toEqual({ itemId: "MLB4049279695", catalogProductId: undefined });
  });

  it("remove tracking e bloqueia SSRF", () => {
    expect(sanitizeMercadoLivreProductUrl("https://www.mercadolivre.com.br/produto/p/MLB18725310?utm_source=x&pdp_filters=item_id%3AMLB6713010960"))
      .toBe("https://www.mercadolivre.com.br/produto/p/MLB18725310?pdp_filters=item_id%3AMLB6713010960");
    expect(() => assertAllowedMercadoLivreUrl("http://127.0.0.1/admin")).toThrow();
    expect(() => assertAllowedMercadoLivreUrl("https://example.com/produto")).toThrow();
  });
});
