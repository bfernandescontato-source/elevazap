import { createHash } from "crypto";
import type { ParsedOffer, RawOfferMessage } from "./types.js";

const URL_PATTERN = /https?:\/\/[^\s<>"']+/gi;
const SHOPEE_HOSTS = new Set(["shopee.com.br", "www.shopee.com.br", "s.shopee.com.br"]);

function trimUrl(value: string) {
  return value.replace(/[),.!?;:]+$/g, "");
}

export function isShopeeUrl(value: string) {
  try { return SHOPEE_HOSTS.has(new URL(value).hostname.toLowerCase()); }
  catch { return false; }
}

export function parseOffer(message: RawOfferMessage): ParsedOffer {
  const text = [message.text, message.caption].filter(Boolean).join("\n").trim();
  const links = Array.from(new Set((text.match(URL_PATTERN) || []).map(trimUrl)));
  const shopeeLinks = links.filter(isShopeeUrl);
  const hashInput = `${text.toLocaleLowerCase("pt-BR").replace(/\s+/g, " ")}|${links.join("|")}`;
  return {
    text,
    media: message.media,
    links,
    shopeeLinks,
    sourceMessageId: message.sourceMessageId,
    sourceGroupId: message.sourceGroupId,
    senderId: message.senderId,
    capturedAt: message.timestamp,
    contentHash: createHash("sha256").update(hashInput).digest("hex")
  };
}
