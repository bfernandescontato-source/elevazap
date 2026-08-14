import type { AffiliateProviderName, ResolvedAffiliateProduct } from "./types.js";

export type AffiliateGenerationContext = {
  accountId: string;
  automationId: string;
  offerId: string;
  sourceGroupId: string;
};

export type AffiliateLinkResult = ResolvedAffiliateProduct & {
  affiliateLink: string;
  affiliateTag?: string;
};

export interface AffiliateProvider {
  readonly name: AffiliateProviderName;
  supports(url: string): boolean;
  resolveUrl(url: string): Promise<ResolvedAffiliateProduct>;
  generateAffiliateLink(product: ResolvedAffiliateProduct, context: AffiliateGenerationContext): Promise<AffiliateLinkResult>;
}

export class UnsupportedAffiliateProviderError extends Error {
  readonly code = "UNSUPPORTED_AFFILIATE_PROVIDER";
}
