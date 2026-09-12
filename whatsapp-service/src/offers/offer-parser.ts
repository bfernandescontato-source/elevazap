import { createHash } from "crypto";
import type { AffiliateProviderName, ParsedOffer, RawOfferMessage } from "./types.js";
import { getAffiliateProviderName } from "./affiliate-provider-router.js";

const URL_PATTERN = /https?:\/\/[^\s<>"']+/gi;
function trimUrl(value: string) {
  return value.replace(/[),.!?;:]+$/g, "");
}

export function isShopeeUrl(value: string) {
  return getAffiliateProviderName(value) === "shopee";
}

export function isMercadoLivreUrl(value: string) {
  return getAffiliateProviderName(value) === "mercado_livre";
}

export function isAmazonUrl(value: string) {
  return getAffiliateProviderName(value) === "amazon";
}

/** O Piloto só pode distribuir ofertas dos marketplaces já integrados. */
export function isSupportedMarketplaceUrl(value: string) {
  return isShopeeUrl(value) || isMercadoLivreUrl(value) || isAmazonUrl(value);
}

export function parseOffer(message: RawOfferMessage): ParsedOffer {
  const text = [message.text, message.caption].filter(Boolean).join("\n").trim();
  const links = Array.from(new Set((text.match(URL_PATTERN) || []).map(trimUrl)));
  const shopeeLinks = links.filter(isShopeeUrl);
  const mercadoLivreLinks = links.filter(isMercadoLivreUrl);
  const amazonLinks = links.filter(isAmazonUrl);
  const affiliateLinks: Array<{ provider: AffiliateProviderName; url: string }> = [];
  for (const url of links) {
    const provider = getAffiliateProviderName(url);
    if (provider !== "unsupported") affiliateLinks.push({ provider, url });
  }
  const hashInput = `${text.toLocaleLowerCase("pt-BR").replace(/\s+/g, " ")}|${links.join("|")}`;
  return {
    text,
    media: message.media,
    links,
    shopeeLinks,
    mercadoLivreLinks,
    amazonLinks,
    affiliateLinks,
    sourceMessageId: message.sourceMessageId,
    sourceGroupId: message.sourceGroupId,
    senderId: message.senderId,
    capturedAt: message.timestamp,
    contentHash: createHash("sha256").update(hashInput).digest("hex")
  };
}
