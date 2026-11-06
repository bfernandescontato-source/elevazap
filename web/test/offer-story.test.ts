import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { STORY_CTA, buildStoryModel, escapeMarkup, formatBRL, realDiscount, shortLinkLabel, storyFileName, wrapTitle } from "../modules/offer-story/story-layout";
import { renderOfferStory } from "../modules/offer-story/server/story-renderer";
import { fetchStoryPhoto, isAllowedImageUrl } from "../modules/offer-story/server/story-photo";

const longName = "Fone de Ouvido Bluetooth 5.3 Sem Fio com Cancelamento de Ruído e Estojo Carregador Original Premium";

async function samplePhoto() {
  return sharp({ create: { width: 800, height: 800, channels: 3, background: "#2E6FD8" } })
    .composite([{ input: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800"><circle cx="400" cy="400" r="260" fill="#F2F2F2"/><rect x="330" y="120" width="140" height="560" rx="60" fill="#1B1B1B"/></svg>') }])
    .jpeg().toBuffer();
}

describe("story da oferta: textos", () => {
  it("formata preço em real com milhar e centavos", () => {
    expect(formatBRL(129.9)).toBe("R$ 129,90");
    expect(formatBRL(1299.9)).toBe("R$ 1.299,90");
    expect(formatBRL(1234567.891)).toBe("R$ 1.234.567,89");
    expect(formatBRL(0.5)).toBe("R$ 0,50");
  });

  it("só mostra desconto real de pelo menos 5%", () => {
    expect(realDiscount(129.9, 199.9)).toBe(35);
    expect(realDiscount(97, 100)).toBeNull();
    expect(realDiscount(100, 100)).toBeNull();
    expect(realDiscount(120, 100)).toBeNull();
    expect(realDiscount(undefined, 100)).toBeNull();
  });

  it("quebra o título em até 3 linhas e corta o resto com reticências", () => {
    const lines = wrapTitle(longName, 24);
    expect(lines).toHaveLength(3);
    lines.forEach(line => expect(line.length).toBeLessThanOrEqual(24));
    expect(lines[2].endsWith("…")).toBe(true);
    expect(wrapTitle("Kindle 16GB", 24)).toEqual(["Kindle 16GB"]);
    expect(wrapTitle("  muitos    espaços  ", 24)).toEqual(["muitos espaços"]);
  });

  it("corta palavra maior que a linha", () => {
    const lines = wrapTitle("Supercalifragilisticexpialidocious123 ok", 10);
    expect(lines.every(line => line.length <= 10)).toBe(true);
    expect(lines[0]).toBe("Supercalif");
  });

  it("mostra só link curto e sem parâmetros", () => {
    expect(shortLinkLabel("https://s.shopee.com.br/4AbCdEf")).toBe("s.shopee.com.br/4AbCdEf");
    expect(shortLinkLabel("https://meli.la/1xYz")).toBe("meli.la/1xYz");
    expect(shortLinkLabel("https://www.amazon.com.br/dp/B0ABC?tag=loja-20")).toBeNull();
    expect(shortLinkLabel("http://s.shopee.com.br/x")).toBeNull();
    expect(shortLinkLabel(undefined)).toBeNull();
  });

  it("monta o conteúdo do story sem selo quando o desconto é pequeno", () => {
    const withDiscount = buildStoryModel({ provider: "SHOPEE", name: "Fone", priceMin: 129.9, originalPrice: 199.9, affiliateUrl: "https://s.shopee.com.br/x1" });
    expect(withDiscount).toMatchObject({ storeLabel: "Shopee", oldPrice: "R$ 199,90", newPrice: "R$ 129,90", discountLabel: "-35%", cta: STORY_CTA, linkLabel: "s.shopee.com.br/x1" });
    const small = buildStoryModel({ provider: "AMAZON", name: "Kindle", priceMin: 98, originalPrice: 100 });
    expect(small.oldPrice).toBeNull(); expect(small.discountLabel).toBeNull(); expect(small.newPrice).toBe("R$ 98,00");
  });

  it("escapa texto para a marcação da fonte e gera nome de arquivo seguro", () => {
    expect(escapeMarkup("Tom & Jerry <3")).toBe("Tom &amp; Jerry &lt;3");
    expect(storyFileName({ provider: "MERCADO_LIVRE", externalItemId: "MLB/../123" })).toBe("story-mercado_livre-MLB123.jpg");
  });

  it("textos da arte não usam travessão", () => {
    expect(STORY_CTA).not.toMatch(/[–—]/);
  });
});

describe("story da oferta: foto", () => {
  it("só busca imagem HTTPS das lojas", () => {
    expect(isAllowedImageUrl("https://down-br.img.susercontent.com/file/abc")).toBe(true);
    expect(isAllowedImageUrl("https://http2.mlstatic.com/D_x.jpg")).toBe(true);
    expect(isAllowedImageUrl("https://m.media-amazon.com/images/I/x.jpg")).toBe(true);
    expect(isAllowedImageUrl("http://m.media-amazon.com/images/I/x.jpg")).toBe(false);
    expect(isAllowedImageUrl("https://169.254.169.254/latest")).toBe(false);
    expect(isAllowedImageUrl("https://evilmlstatic.com/x.jpg")).toBe(false);
    expect(isAllowedImageUrl("https://mlstatic.com.evil.io/x.jpg")).toBe(false);
  });

  it("não segue redirecionamento e devolve null quando não é imagem", async () => {
    let init: RequestInit | undefined;
    const fetcher = (async (_url: unknown, options?: RequestInit) => { init = options; return new Response("<html>", { headers: { "content-type": "text/html" } }); }) as typeof fetch;
    expect(await fetchStoryPhoto("https://http2.mlstatic.com/x.jpg", fetcher)).toBeNull();
    expect(init?.redirect).toBe("error");
    expect(await fetchStoryPhoto("https://exemplo.com/x.jpg", fetcher)).toBeNull();
  });
});

describe("story da oferta: imagem", () => {
  it("gera JPEG 1080x1920 com e sem foto", async () => {
    const model = buildStoryModel({ provider: "SHOPEE", name: longName, priceMin: 129.9, originalPrice: 199.9, affiliateUrl: "https://s.shopee.com.br/4AbCdEfGh" });
    const image = await renderOfferStory(model, await samplePhoto());
    const meta = await sharp(image).metadata();
    expect(meta).toMatchObject({ format: "jpeg", width: 1080, height: 1920 });
    expect(image.length).toBeLessThan(1_500_000);

    const plain = buildStoryModel({ provider: "AMAZON", name: "Kindle 16GB", priceMin: 1299.9, originalPrice: 1310, affiliateUrl: "https://www.amazon.com.br/dp/B0?tag=x-20" });
    const noPhoto = await renderOfferStory(plain, null);
    expect(await sharp(noPhoto).metadata()).toMatchObject({ format: "jpeg", width: 1080, height: 1920 });

    // Foto corrompida não derruba o story.
    const broken = await renderOfferStory(plain, Buffer.from("não é imagem"));
    expect((await sharp(broken).metadata()).height).toBe(1920);

    const dir = process.env.STORY_SAMPLE_DIR;
    if (dir) {
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "story-exemplo.jpg"), image);
      writeFileSync(join(dir, "story-exemplo-sem-desconto.jpg"), noPhoto);
    }
  }, 30_000);
});
