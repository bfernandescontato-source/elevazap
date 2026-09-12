export type AmazonFetch = typeof fetch;
export function isAmazonUrl(value: string): boolean;
export function addAmazonPartnerTag(value: string, partnerTag: string): string;
export function validateAmazonAffiliateUrl(value: string, partnerTag: string): boolean;
export function resolveAmazonUrl(value: string, fetcher?: AmazonFetch): Promise<string>;
export function convertAmazonLink(value: string, partnerTag: string, fetcher?: AmazonFetch): Promise<{ affiliate_url: string; resolved_url: string }>;
