import { buildOfferCopy, type OfferCopyFacts } from "@disparei/affiliate-links/offer-copy";
import { offerShownPercent, selectOfferHook, type HookSettings } from "@disparei/affiliate-links/offer-hooks";
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

/** Dados da oferta do marketplace no formato que o modelo fixo usa. */
export function catalogOfferFacts(offer: AffiliateOffer): OfferCopyFacts {
  const priceTo = cents(offer.priceMin);
  const priceFrom = cents(offer.originalPrice);
  return {
    productName: offer.name.trim(),
    priceFromCents: priceFrom && priceTo && priceFrom > priceTo ? priceFrom : null,
    priceToCents: priceTo,
    priceCondition: null,
    statedDiscountPercent: offer.discountPercentage ? Math.floor(offer.discountPercentage) : null,
    coupon: null,
    extraLines: []
  };
}

/** Escolha do gancho já feita no servidor (posição do contador e gancho da IA). */
export type CatalogHookChoice = { settings?: HookSettings | null; sequence?: number | null; aiHook?: string | null };

/**
 * Mensagem do Catálogo: o mesmo modelo fixo do Piloto (gancho, De/Por, sem
 * desconto 0%), montado só com os dados do marketplace. O gancho segue a
 * escolha da conta em Ganchos; sem configuração, sorteia da lista do sistema.
 */
export function buildCatalogOfferMessage(offer: AffiliateOffer, affiliateUrl: string, random: () => number = Math.random, choice: CatalogHookChoice = {}) {
  const facts = catalogOfferFacts(offer);
  const hook = choice.settings
    ? selectOfferHook(choice.settings, { shownPercent: offerShownPercent(facts), random, sequence: choice.sequence ?? null, aiHook: choice.aiHook ?? null })
    : undefined;
  return buildOfferCopy(facts, affiliateUrl, random, { hook });
}
