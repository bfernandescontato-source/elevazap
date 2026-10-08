import { describe, expect, it } from "vitest";

import { marketplaceOf, PilotoLinkError, resolveProductUrl, shopeeItemId } from "@/modules/piloto-link/server/service";

function redirects(map: Record<string, string>): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const location = map[String(input)];
    return new Response(null, { status: location ? 302 : 200, headers: location ? { location } : {} });
  }) as typeof fetch;
}

describe("Piloto: link de afiliado pelo Disparei", () => {
  it("reconhece as lojas suportadas", () => {
    expect(marketplaceOf(new URL("https://s.shopee.com.br/abc"))).toBe("shopee");
    expect(marketplaceOf(new URL("https://shopee.com.br/produto-i.1.2"))).toBe("shopee");
    expect(marketplaceOf(new URL("https://amzn.to/xyz"))).toBe("amazon");
    expect(marketplaceOf(new URL("https://exemplo.com/x"))).toBeNull();
  });

  it("abre o link curto de outra pessoa e devolve só o endereço do produto", async () => {
    const fetcher = redirects({
      "https://s.shopee.com.br/1BKAMUO5LU": "https://shopee.com.br/Removedor-de-Pelo-i.123.456?utm_source=an_999&mmp_pid=an_999",
    });
    await expect(resolveProductUrl("https://s.shopee.com.br/1BKAMUO5LU", fetcher)).resolves.toEqual({
      marketplace: "shopee",
      url: "https://shopee.com.br/Removedor-de-Pelo-i.123.456",
    });
  });

  it("link direto do produto não faz requisição", async () => {
    const fetcher = (async () => { throw new Error("não devia chamar"); }) as unknown as typeof fetch;
    await expect(resolveProductUrl("https://shopee.com.br/x-i.1.2?sp_atk=abc", fetcher)).resolves.toEqual({
      marketplace: "shopee", url: "https://shopee.com.br/x-i.1.2",
    });
  });

  it("não segue redirecionamento para fora das lojas", async () => {
    const fetcher = redirects({ "https://s.shopee.com.br/x": "https://golpe.example/login" });
    await expect(resolveProductUrl("https://s.shopee.com.br/x", fetcher)).rejects.toBeInstanceOf(PilotoLinkError);
  });

  it("recusa loja desconhecida e link inválido", async () => {
    await expect(resolveProductUrl("https://exemplo.com/p")).rejects.toMatchObject({ code: "unsupported" });
    await expect(resolveProductUrl("não é link")).rejects.toMatchObject({ code: "invalid_url" });
  });

  it("acha o código do produto na Shopee", () => {
    expect(shopeeItemId("https://shopee.com.br/opaanlp/363220493/16128265568")).toBe("16128265568");
    expect(shopeeItemId("https://shopee.com.br/Removedor-de-Pelo-i.123.456")).toBe("456");
    expect(shopeeItemId("https://shopee.com.br/product/1/2")).toBe("2");
    expect(shopeeItemId("https://shopee.com.br/")).toBeNull();
  });
});
