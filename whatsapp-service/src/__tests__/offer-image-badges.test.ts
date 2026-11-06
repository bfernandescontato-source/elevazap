import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { writeFile, mkdir } from "fs/promises";
import { join } from "path";
import {
  badgeDiscountPercent, decideOfferBadges, formatDiscountBadge, offerBadgeFactsFromText, offerBadgesKey, sanitizeOfferBadges
} from "@disparei/affiliate-links/offer-badges";
import { composeOriginalOfferImage, renderBadgeOverlay, sampleProductImage } from "../queue/offer-image-badges.js";
import { LINK_THUMBNAIL_SIZE, standardizeLinkImage } from "../queue/link-thumbnail.js";

const ON = { discountBadge: true, freeShippingBadge: true };

describe("quando mostrar os selos", () => {
  it("mostra desconto real de 5% ou mais e nunca 0%", () => {
    expect(badgeDiscountPercent({ price: 48, originalPrice: 100 })).toBe(52);
    expect(badgeDiscountPercent({ price: 100, originalPrice: 100 })).toBeNull();
    expect(badgeDiscountPercent({ price: 97, originalPrice: 100 })).toBeNull();
    expect(badgeDiscountPercent({ price: 120, originalPrice: 100, statedDiscountPercent: 30 })).toBeNull();
    expect(badgeDiscountPercent({ statedDiscountPercent: 0 })).toBeNull();
    expect(badgeDiscountPercent({ statedDiscountPercent: 4.9 })).toBeNull();
    expect(badgeDiscountPercent({ statedDiscountPercent: 99 })).toBeNull();
    expect(badgeDiscountPercent({ statedDiscountPercent: 33.8 })).toBe(33);
  });

  it("respeita a configuração da conta e só põe frete grátis quando a oferta diz", () => {
    expect(decideOfferBadges({ price: 48, originalPrice: 100, freeShipping: true }, ON)).toEqual({ discountPercent: 52, freeShipping: true });
    expect(decideOfferBadges({ price: 48, originalPrice: 100, freeShipping: true }, { discountBadge: false, freeShippingBadge: true })).toEqual({ freeShipping: true });
    expect(decideOfferBadges({ price: 48, originalPrice: 100 }, { discountBadge: false, freeShippingBadge: true })).toBeNull();
    expect(decideOfferBadges({ price: 48, originalPrice: 100 }, null)).toBeNull();
  });

  it("formata o texto e limpa dados de fora", () => {
    expect(formatDiscountBadge(52)).toBe("-52%");
    expect(formatDiscountBadge(0)).toBeNull();
    expect(sanitizeOfferBadges({ discountPercent: "52", freeShipping: "sim" })).toEqual({ discountPercent: 52 });
    expect(sanitizeOfferBadges({ discountPercent: 2 })).toBeNull();
    expect(offerBadgesKey({ discountPercent: 52, freeShipping: true })).toBe("d52f");
    expect(offerBadgesKey(null)).toBe("none");
  });

  it("lê do texto do Piloto só o que está escrito", () => {
    expect(decideOfferBadges(offerBadgeFactsFromText("😱🔻52% DE DESCONTO\n❌ De: ~R$100,00~\n✅ Por: R$48,00"), ON)).toEqual({ discountPercent: 52 });
    expect(decideOfferBadges(offerBadgeFactsFromText("De R$ 199,90 por R$ 99,90 com frete grátis"), ON)).toEqual({ discountPercent: 50, freeShipping: true });
    expect(decideOfferBadges(offerBadgeFactsFromText("Frete grátis acima de R$ 79\nPor R$ 50"), ON)).toBeNull();
    expect(decideOfferBadges(offerBadgeFactsFromText("Até 70% OFF na loja toda"), ON)).toBeNull();
    expect(decideOfferBadges(offerBadgeFactsFromText("Frete grátis para membros Prime"), ON)).toBeNull();
    expect(decideOfferBadges(offerBadgeFactsFromText("Só R$ 39,90"), ON)).toBeNull();
  });
});

describe("desenho dos selos", () => {
  it("não desenha nada sem selo e usa caminhos, não texto com fonte", () => {
    expect(renderBadgeOverlay(800, 800, null)).toBeNull();
    const svg = renderBadgeOverlay(800, 800, { discountPercent: 52, freeShipping: true })!;
    expect(svg).toContain("<path");
    expect(svg).not.toContain("<text");
  });

  it("card do link sai JPEG 800x800 com os selos", async () => {
    const source = await sampleProductImage();
    const { image } = await standardizeLinkImage(source, { discountPercent: 52, freeShipping: true });
    const meta = await sharp(image).metadata();
    expect([meta.format, meta.width, meta.height]).toEqual(["jpeg", LINK_THUMBNAIL_SIZE, LINK_THUMBNAIL_SIZE]);
    // Canto de cima à esquerda ficou vermelho (selo de desconto).
    const { data } = await sharp(image).extract({ left: 60, top: 60, width: 4, height: 4 }).raw().toBuffer({ resolveWithObject: true });
    expect(data[0]).toBeGreaterThan(180); expect(data[1]).toBeLessThan(80);
    const out = process.env.BADGE_SAMPLE_DIR;
    if (out) { await mkdir(out, { recursive: true }); await writeFile(join(out, "card-800.jpg"), image); }
  });

  it("foto original mantém a proporção e recebe os selos", async () => {
    const wide = await sharp({ create: { width: 1600, height: 900, channels: 4, background: "#3366ff80" } }).png().toBuffer();
    const image = await composeOriginalOfferImage(wide, { discountPercent: 35, freeShipping: true });
    const meta = await sharp(image).metadata();
    expect([meta.format, meta.width, meta.height]).toEqual(["jpeg", 1280, 720]);
    const out = process.env.BADGE_SAMPLE_DIR;
    if (out) await writeFile(join(out, "original-1280x720.jpg"), image);
  });
});
