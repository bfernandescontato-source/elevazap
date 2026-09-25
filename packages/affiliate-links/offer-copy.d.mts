export declare const DISCOUNT_HOOKS: string[];
export declare const GENERAL_HOOKS: string[];
export declare const MIN_DISCOUNT_PERCENT: number;
export declare const STRONG_DISCOUNT_HOOK_PERCENT: number;
export declare const OFFER_DISCLAIMER: string;

export type OfferCopyFacts = {
  productName: string;
  priceFromCents: number | null;
  priceToCents: number | null;
  /** Payment condition tied to the price, as written in the offer ("no Pix", "à vista"). */
  priceCondition: string | null;
  /** Percent off written in the offer ("50% off"), used only when there is no old price to compute it from. */
  statedDiscountPercent: number | null;
  coupon: string | null;
  extraLines: string[];
};

export function brlAmountsInCents(text: string): number[];
export function parseBrlPrice(value: string | null | undefined): number | null;
export function formatBrl(cents: number): string;
export function discountPercent(fromCents: number | null, toCents: number | null): number | null;
export function buildOfferCopy(facts: OfferCopyFacts, purchaseLink: string, random?: () => number): string;
