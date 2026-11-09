import { describe, expect, it } from "vitest";
import { decideOfferBadges, DEFAULT_OFFER_IMAGE_SETTINGS } from "@disparei/affiliate-links/offer-badges";
import { bulkScheduleSchema, dispatchOfferSchema } from "@/modules/affiliate-catalog/schemas";
import { normalizeMercadoLivreOffer } from "@/modules/affiliate-catalog/server/mercado-livre-provider";
import { offerImageSettingsSchema } from "@/modules/offer-images/schemas";

const offer = { provider: "MERCADO_LIVRE", externalItemId: "MLB1", name: "Fone", priceMin: 48, originalPrice: 100, freeShipping: true };
const base = { offer, message: "Fone https://meli.la/abc", senderId: "11111111-1111-4111-8111-111111111111", groupJids: ["1@g.us"] };

describe("imagem das ofertas no Catálogo", () => {
  it("sem escolha no envio, deixa para o padrão da conta", () => {
    const parsed = dispatchOfferSchema.parse(base);
    expect(parsed.imageMode).toBeUndefined();
    expect(dispatchOfferSchema.parse({ ...base, imageMode: "product_link_preview" }).imageMode).toBe("product_link_preview");
    expect(bulkScheduleSchema.parse({ items: [{ offer, scheduledAt: "2026-11-06T10:00:00-03:00" }], senderId: base.senderId, groupJids: base.groupJids }).imageMode).toBeUndefined();
  });

  it("guarda o frete grátis da oferta para o selo", () => {
    expect(dispatchOfferSchema.parse(base).offer.freeShipping).toBe(true);
    expect(normalizeMercadoLivreOffer({ id: "MLB2", price: 50, original_price: 100, shipping: { free_shipping: true } }).freeShipping).toBe(true);
    expect(normalizeMercadoLivreOffer({ id: "MLB3", price: 50 }).freeShipping).toBeUndefined();
  });

  it("conta sem configuração não ganha selo", () => {
    expect(DEFAULT_OFFER_IMAGE_SETTINGS).toEqual({ defaultImageMode: "original_image", discountBadge: false, freeShippingBadge: false });
    expect(decideOfferBadges({ price: 48, originalPrice: 100, freeShipping: true }, DEFAULT_OFFER_IMAGE_SETTINGS)).toBeNull();
    expect(decideOfferBadges({ price: 48, originalPrice: 100, freeShipping: true }, { discountBadge: true, freeShippingBadge: true })).toEqual({ discountPercent: 52, freeShipping: true });
  });

  it("valida a configuração salva", () => {
    expect(offerImageSettingsSchema.safeParse({ defaultImageMode: "product_link_preview", discountBadge: true, freeShippingBadge: false }).success).toBe(true);
    expect(offerImageSettingsSchema.safeParse({ defaultImageMode: "gif", discountBadge: true, freeShippingBadge: false }).success).toBe(false);
  });
});
