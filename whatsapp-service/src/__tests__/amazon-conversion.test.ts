import { describe, expect, it, vi } from "vitest";
import { AmazonOfferConverter } from "../offers/amazon-conversion.js";
import type { ParsedOffer } from "../offers/types.js";
import { amazonMessageIsSafe } from "../queue/amazon-safety.js";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function parsed(...links: string[]): ParsedOffer {
  return {
    text: links.join("\n"), media: undefined, links, shopeeLinks: [], mercadoLivreLinks: [], amazonLinks: links,
    affiliateLinks: links.map((url) => ({ provider: "amazon", url })), sourceMessageId: "message-1",
    sourceGroupId: "120363000000000@g.us", capturedAt: new Date(), contentHash: "hash"
  };
}

function databaseFor(accountTags: Record<string, string | undefined>) {
  let selectedAccount = "";
  const chain: any = {
    select: () => chain,
    eq: (column: string, value: string) => { if (column === "account_id") selectedAccount = value; return chain; },
    maybeSingle: async () => ({ data: accountTags[selectedAccount] ? { status: "connected", affiliate_tag: accountTags[selectedAccount] } : null, error: null })
  };
  return { from: vi.fn(() => chain) } as any;
}

const context = { accountId: "account-a", automationId: "automation-1", offerId: "offer-1", sourceGroupId: "group-1" };

describe("conversão Amazon do Piloto", () => {
  it("converte todos os links e nunca usa o tag de outra conta", async () => {
    const database = databaseFor({ "account-a": "tag-a-20", "account-b": "tag-b-20" });
    const input = parsed("https://amazon.com.br/dp/AAA?tag=antiga-20", "https://www.amazon.com.br/dp/BBB?ref_=grupo");
    const result = await new AmazonOfferConverter(database).convert(input, context);
    const urls = result.processedText.match(/https?:\/\/\S+/g) || [];
    expect(urls).toHaveLength(2);
    expect(urls.every((url) => amazonMessageIsSafe(url, "tag-a-20"))).toBe(true);
    expect(result.processedText).not.toContain("tag-b-20");
    expect(result.processedText).not.toContain("antiga-20");
    expect(result.processedText).toContain("ref_=grupo");
  });

  it("falha fechado se qualquer link curto não puder ser convertido", async () => {
    const convert = vi.fn(async () => { throw new Error("Falha ao resolver"); });
    const converter = new AmazonOfferConverter(databaseFor({ "account-a": "tag-a-20" }), convert as any);
    await expect(converter.convert(parsed("https://amzn.to/invalido"), context)).rejects.toThrow("Falha ao resolver");
  });

  it("revalidação pré-envio exige exatamente o tag atual", () => {
    expect(amazonMessageIsSafe("Oferta https://amazon.com.br/dp/AAA?ref_=x&tag=tag-a-20", "tag-a-20")).toBe(true);
    expect(amazonMessageIsSafe("Oferta https://amazon.com.br/dp/AAA?tag=tag-antiga-20", "tag-a-20")).toBe(false);
    expect(amazonMessageIsSafe("Oferta https://amazon.com.br/dp/AAA?tag=tag-a-20&TAG=tag-a-20", "tag-a-20")).toBe(false);
    expect(amazonMessageIsSafe("Oferta https://amzn.to/original", "tag-a-20")).toBe(false);
  });

  it("revalida Amazon depois do claim e antes de marcar a entrega como sending", () => {
    const source = readFileSync(resolve(__dirname, "../queue/queue.ts"), "utf8");
    const amazonGuard = source.indexOf("cancelIfAmazonUnavailable(row)");
    const sending = source.indexOf('syncOfferDelivery(row.id, "sending")');
    expect(amazonGuard).toBeGreaterThan(-1);
    expect(amazonGuard).toBeLessThan(sending);
    expect(source).toContain('last_error_code: connected ? "AMAZON_LINK_CONVERSION_FAILED" : "AMAZON_NOT_CONNECTED"');
  });
});

describe("preview de produto da Amazon", () => {
  it("reconhece a página de captcha e não confunde com a página do produto", async () => {
    const { isAmazonCaptchaPage } = await import("../queue/link-preview-page.js");
    const captcha = `<html><head><title dir="ltr">Amazon.com.br</title></head><body><form action="/errors/validateCaptcha"><input name="amzn-captcha"></form></body></html>`;
    const product = `<html><head><meta property="og:image" content="https://m.media-amazon.com/images/I/71DSWwyIa7L.jpg"></head><body><img id="landingImage" data-old-hires="https://m.media-amazon.com/images/I/71DSWwyIa7L._AC_SL1500_.jpg"><script>var captchaTheme = 1;</script></body></html>`;
    expect(isAmazonCaptchaPage(captcha)).toBe(true);
    expect(isAmazonCaptchaPage(product)).toBe(false);
  });
});

describe("miniatura do card de link", () => {
  it("pede a foto do Mercado Livre em JPEG e não mexe nas outras", async () => {
    const { toJpegLinkThumbnailUrl } = await import("../queue/link-preview-page.js");
    expect(toJpegLinkThumbnailUrl(new URL("https://http2.mlstatic.com/D_NQ_NP_900432-MLA113518359539_062026-O.webp")).toString())
      .toBe("https://http2.mlstatic.com/D_NQ_NP_900432-MLA113518359539_062026-O.jpg");
    const amazon = "https://m.media-amazon.com/images/I/71DSWwyIa7L._AC_SX355_.jpg";
    expect(toJpegLinkThumbnailUrl(new URL(amazon)).toString()).toBe(amazon);
  });
});

describe("medidas da foto do card", () => {
  it("lê largura e altura do cabeçalho JPEG", async () => {
    const { jpegDimensions } = await import("../queue/link-preview-page.js");
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x03, 0xfb, 0x02, 0xa7, 0x03, 0x01, 0x22, 0x00]);
    expect(jpegDimensions(jpeg)).toEqual({ width: 679, height: 1019 });
    expect(jpegDimensions(Buffer.from("not an image"))).toBeUndefined();
  });
});
