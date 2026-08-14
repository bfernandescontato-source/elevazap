import { describe, expect, it } from "vitest";
import { assertAllowedShopeeUrl, extractShopeeProductIdentifiers, replaceUrlPreservingText, sanitizeShopeeProductUrl } from "../offers/shopee-url-resolver.js";

describe("ShopeeUrlResolver", () => {
  it("detecta short link Shopee", () => {
    expect(assertAllowedShopeeUrl("https://s.shopee.com.br/abc").hostname).toBe("s.shopee.com.br");
  });

  it("remove tracking sem perder os identificadores do produto", () => {
    const result = sanitizeShopeeProductUrl("https://shopee.com.br/Produto-i.123.456?utm_source=affiliate&uls_trackid=old&variation=7");
    expect(result).toBe("https://shopee.com.br/Produto-i.123.456?variation=7");
    expect(extractShopeeProductIdentifiers(result)).toEqual({ shopId: "123", itemId: "456" });
  });

  it("reconhece o formato de produto retornado por links curtos", () => {
    const result = sanitizeShopeeProductUrl("https://shopee.com.br/opaanlp/1425525131/22794190920?__mobile__=1&exp_group=rollout&gads_t_sig=old&mmp_pid=affiliate&utm_source=old");
    expect(result).toBe("https://shopee.com.br/opaanlp/1425525131/22794190920");
    expect(extractShopeeProductIdentifiers(result)).toEqual({ shopId: "1425525131", itemId: "22794190920" });
  });

  it("substitui apenas o link classificado como produto", () => {
    const coupon = "https://shopee.com.br/cupom";
    const product = "https://shopee.com.br/Produto-i.123.456";
    const text = `Cupom: ${coupon}\nProduto: ${product}`;
    const result = replaceUrlPreservingText(text, product, "https://s.shopee.com.br/novo");
    expect(result).toContain(coupon);
    expect(result).toContain("https://s.shopee.com.br/novo");
    expect(result).not.toContain(product);
  });

  it("bloqueia protocolos, hosts e destinos locais", () => {
    expect(() => assertAllowedShopeeUrl("http://127.0.0.1/admin")).toThrow();
    expect(() => assertAllowedShopeeUrl("file:///etc/passwd")).toThrow();
    expect(() => assertAllowedShopeeUrl("https://example.com/produto")).toThrow();
  });
});
