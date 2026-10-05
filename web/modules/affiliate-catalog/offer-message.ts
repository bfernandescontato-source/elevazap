import { buildOfferCopy } from "@disparei/affiliate-links/offer-copy";
import type { AffiliateOffer } from "./types";

const cents = (value?: number) => value === undefined || !Number.isFinite(value) || value <= 0 ? null : Math.round(value * 100);

/**
 * Sorteio do gancho fixo por produto e dia: a prévia do agendamento em massa e o
 * servidor chegam na mesma mensagem, e o mesmo produto ainda varia de um dia
 * para o outro.
 */
export function catalogMessageRandom(offer: Pick<AffiliateOffer, "provider" | "externalItemId">, day: string): () => number {
  let seed = 2166136261;
  for (const char of `${offer.provider}:${offer.externalItemId}:${day}`) seed = Math.imul(seed ^ char.charCodeAt(0), 16777619);
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

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
