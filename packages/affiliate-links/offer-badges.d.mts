export type OfferImageMode = "original_image" | "product_link_preview";
export type OfferImageSettings = { defaultImageMode: OfferImageMode; discountBadge: boolean; freeShippingBadge: boolean };
export type OfferBadges = { discountPercent?: number; freeShipping?: true };
export type OfferBadgeFacts = { price?: number; originalPrice?: number; statedDiscountPercent?: number; freeShipping?: boolean };

export declare const MAX_BADGE_DISCOUNT_PERCENT: number;
export declare const FREE_SHIPPING_BADGE_TEXT: string;
export declare const OFFER_IMAGE_MODES: readonly OfferImageMode[];
export declare const DEFAULT_OFFER_IMAGE_SETTINGS: Readonly<OfferImageSettings>;

export function badgeDiscountPercent(facts?: OfferBadgeFacts): number | null;
export function decideOfferBadges(facts?: OfferBadgeFacts, settings?: Pick<OfferImageSettings, "discountBadge" | "freeShippingBadge"> | null): OfferBadges | null;
export function sanitizeOfferBadges(value: unknown): OfferBadges | null;
export function formatDiscountBadge(percent: unknown): string | null;
export function offerBadgesKey(badges: unknown): string;
export function offerBadgeFactsFromText(text: string | null | undefined): OfferBadgeFacts;
