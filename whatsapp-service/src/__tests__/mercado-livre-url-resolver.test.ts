import { describe, expect, it } from "vitest";
import { assertAllowedMercadoLivreUrl, extractFeaturedSocialProduct, extractMercadoLivreProductIdentifiers, sanitizeMercadoLivreProductUrl } from "../offers/mercado-livre-url-resolver.js";

function socialPageFixture(metadata: Record<string, unknown>) {
  const state = {
    appProps: {
      pageProps: {
        data: {
          components: [
            { id: "affiliate-profile-header" },
            {
              id: "card-featured",
              track: { c_id: "/home/card-featured" },
              recommendation_data: { recommendation_info: { polycards: [{ metadata }] } }
            },
            { id: "affiliate-profile-recommendations" }
          ]
        }
      }
    }
  };
  return `<html><body><script id="__NORDIC_RENDERING_CTX__">_n.ctx.r=${JSON.stringify(state)};</script></body></html>`;
}

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

  it("extrai o produto em destaque de uma vitrine social com produto de catálogo", () => {
    const html = socialPageFixture({
      id: "MLB6796040122", product_id: "MLB50362602", user_product_id: "MLBU3839879047",
      url: "www.mercadolivre.com.br/shampoo-gloss-absolu-bain-hydra-glaze-80ml-kerastase/p/MLB50362602"
    });
    expect(extractFeaturedSocialProduct(html)).toEqual({
      itemId: "MLB6796040122", catalogProductId: "MLB50362602",
      url: "https://www.mercadolivre.com.br/shampoo-gloss-absolu-bain-hydra-glaze-80ml-kerastase/p/MLB50362602"
    });
  });

  it("extrai o produto em destaque de uma vitrine social sem produto de catálogo (anúncio de vendedor)", () => {
    const html = socialPageFixture({
      id: "MLB6296884036", product_id: null, user_product_id: "MLBU3816075868",
      url: "www.mercadolivre.com.br/kit2sapateiras-8-pares-sapatos-pequena-para-entrada-da-porta/up/MLBU3816075868"
    });
    expect(extractFeaturedSocialProduct(html)).toEqual({
      itemId: "MLB6296884036", catalogProductId: undefined,
      url: "https://www.mercadolivre.com.br/kit2sapateiras-8-pares-sapatos-pequena-para-entrada-da-porta/up/MLBU3816075868"
    });
  });

  it("retorna undefined quando a vitrine não tem card em destaque ou o HTML é inesperado", () => {
    expect(extractFeaturedSocialProduct("<html><body>sem estado embutido</body></html>")).toBeUndefined();
    const htmlWithoutFeatured = `<html><body><script id="__NORDIC_RENDERING_CTX__">_n.ctx.r=${JSON.stringify({
      appProps: { pageProps: { data: { components: [{ id: "affiliate-profile-header" }] } } }
    })};</script></body></html>`;
    expect(extractFeaturedSocialProduct(htmlWithoutFeatured)).toBeUndefined();
  });
});
