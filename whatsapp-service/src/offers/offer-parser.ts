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

const AMAZON_HOSTS = new Set(["amazon.com.br", "www.amazon.com.br", "amazon.com", "www.amazon.com", "amzn.to", "a.co"]);
export function isAmazonUrl(value: string) {
  try {
    // A Amazon é dona do gTLD ".amazon" e usa domínios como link.amazon
    // (share links do app) além dos clássicos amazon.com.br / amzn.to.
    const hostname = new URL(value).hostname.toLowerCase();
    return AMAZON_HOSTS.has(hostname) || hostname === "amazon" || hostname.endsWith(".amazon");
  } catch { return false; }
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
