import { describe, expect, it, vi } from "vitest";
import { addAmazonPartnerTag, convertAmazonLink, isAmazonUrl, resolveAmazonUrl } from "@disparei/affiliate-links/amazon";
import { amazonPartnerTagSchema } from "../modules/integrations/schemas";

const TAG = "achadin0c8d8c-20";

describe("conversão manual de links Amazon", () => {
  it("adiciona o Partner Tag a um link sem parâmetros", () => {
    expect(addAmazonPartnerTag("https://www.amazon.com.br/dp/B0XXXXX", TAG))
      .toBe(`https://www.amazon.com.br/dp/B0XXXXX?tag=${TAG}`);
  });

  it("preserva parâmetros e fragmento e substitui qualquer tag anterior", () => {
    const result = addAmazonPartnerTag("https://amazon.com.br/dp/B0XXXXX?ref_=abc&tag=antiga-20#detalhes", TAG);
    const url = new URL(result);
    expect(url.searchParams.get("ref_")).toBe("abc");
    expect(url.searchParams.getAll("tag")).toEqual([TAG]);
    expect(url.hash).toBe("#detalhes");
  });

  it("remove tags duplicadas inclusive com capitalização diferente", () => {
    const result = addAmazonPartnerTag("https://amazon.com.br/dp/B0XXXXX?TAG=uma-20&tag=outra-20", TAG);
    expect(Array.from(new URL(result).searchParams.entries())).toEqual([["tag", TAG]]);
  });

  it("rejeita domínios parecidos e protocolos não seguros", () => {
    expect(() => addAmazonPartnerTag("https://amazon.com.br.evil.test/dp/B0XXXXX", TAG)).toThrow();
    expect(() => addAmazonPartnerTag("http://amazon.com.br/dp/B0XXXXX", TAG)).toThrow();
  });

  it("resolve link curto somente quando o destino é a Amazon Brasil", async () => {
    const request = vi.fn(async () => new Response(null, { status: 302, headers: { location: "https://www.amazon.com.br/dp/B0XXXXX?ref_=short" } }));
    const result = await convertAmazonLink("https://amzn.to/exemplo", TAG, request as typeof fetch);
    expect(result.affiliate_url).toBe(`https://www.amazon.com.br/dp/B0XXXXX?ref_=short&tag=${TAG}`);
  });

  it("bloqueia redirecionamento de link curto para domínio externo", async () => {
    const request = vi.fn(async () => new Response(null, { status: 302, headers: { location: "https://evil.test/produto" } }));
    await expect(resolveAmazonUrl("https://amzn.to/exemplo", request as typeof fetch)).rejects.toThrow("Amazon Brasil");
  });

  it("não retorna o link original quando a resolução falha", async () => {
    const request = vi.fn(async () => { throw new Error("network"); });
    await expect(convertAmazonLink("https://amzn.to/exemplo", TAG, request as typeof fetch)).rejects.toThrow();
  });

  it("reconhece amzlink.me (encurtador de terceiro verificado) e converte quando o destino é a Amazon Brasil", async () => {
    expect(isAmazonUrl("https://amzlink.me/5afajz0")).toBe(true);
    const request = vi.fn(async () => new Response(null, {
      status: 307,
      headers: { location: "https://www.amazon.com.br/dp/B07DTN9W36?tag=outra-conta-20" }
    }));
    const result = await convertAmazonLink("https://amzlink.me/5afajz0", TAG, request as typeof fetch);
    expect(result.resolved_url).toBe("https://www.amazon.com.br/dp/B07DTN9W36?tag=outra-conta-20");
    expect(new URL(result.affiliate_url).searchParams.getAll("tag")).toEqual([TAG]);
  });

  it("ainda bloqueia encurtadores de terceiro não aprovados explicitamente", () => {
    expect(isAmazonUrl("https://amzlinks.in/B09iZUsu8")).toBe(false);
  });

  it("exige Partner Tag e valida seu formato", async () => {
    await expect(convertAmazonLink("https://amazon.com.br/dp/B0XXXXX", "")).rejects.toThrow("Configure");
    expect(amazonPartnerTagSchema.safeParse({ partner_tag: TAG }).success).toBe(true);
    expect(amazonPartnerTagSchema.safeParse({ partner_tag: "tag inválida" }).success).toBe(false);
  });
});
