import { buildOfferCopy } from "@disparei/affiliate-links/offer-copy";
import type { AffiliateOffer } from "./types";

const cents = (value?: number) => value === undefined || !Number.isFinite(value) || value <= 0 ? null : Math.round(value * 100);

/**
 * Mensagem do agendamento em massa: o mesmo modelo fixo do Piloto (gancho
 * aprovado, De/Por, sem desconto 0%), montado só com os dados do marketplace.
 */
export function buildCatalogOfferMessage(offer: AffiliateOffer, affiliateUrl: string, random: () => number = Math.random) {
  const priceTo = cents(offer.priceMin);
  const priceFrom = cents(offer.originalPrice);
  return buildOfferCopy({
    productName: offer.name.trim(),
    priceFromCents: priceFrom && priceTo && priceFrom > priceTo ? priceFrom : null,
    priceToCents: priceTo,
    priceCondition: null,
    statedDiscountPercent: offer.discountPercentage ? Math.floor(offer.discountPercentage) : null,
    coupon: null,
    extraLines: []
  }, affiliateUrl, random);
}
