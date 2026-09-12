import { isAmazonUrl, validateAmazonAffiliateUrl } from "@disparei/affiliate-links/amazon";

const URL_PATTERN = /https?:\/\/[^\s<>"']+/gi;

export function amazonLinksInMessage(text: string) {
  return (text.match(URL_PATTERN) || []).map((value) => value.replace(/[),.!?;:]+$/g, "")).filter(isAmazonUrl);
}

export function amazonMessageIsSafe(text: string, partnerTag: string) {
  const links = amazonLinksInMessage(text);
  return links.length > 0 && links.every((link) => validateAmazonAffiliateUrl(link, partnerTag));
}
