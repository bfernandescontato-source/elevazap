import axios from "axios";
import { lookup } from "dns/promises";
import { isIP } from "net";
import { Agent } from "https";

const INPUT_HOSTS = new Set(["shopee.com.br", "www.shopee.com.br", "s.shopee.com.br"]);
const MAX_REDIRECTS = 5;
const TRACKING_PARAMS = [/^utm_/i, /^uls_/i, /^affiliate_/i, /^sub_id$/i, /^af_/i, /^gclid$/i, /^fbclid$/i];

export type ShopeeProductIdentifiers = { shopId?: string; itemId?: string };

function privateIp(address: string) {
  if (address === "127.0.0.1" || address === "::1" || address === "0.0.0.0" || address === "169.254.169.254") return true;
  if (address.startsWith("10.") || address.startsWith("192.168.") || address.startsWith("169.254.")) return true;
  const match = address.match(/^172\.(\d+)\./);
  if (match && Number(match[1]) >= 16 && Number(match[1]) <= 31) return true;
  return address.startsWith("fc") || address.startsWith("fd") || address.startsWith("fe80:");
}

export function assertAllowedShopeeUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== "https:" || !INPUT_HOSTS.has(url.hostname.toLowerCase())) throw new Error("URL Shopee não permitida.");
  if (isIP(url.hostname) || url.username || url.password || url.port) throw new Error("URL Shopee inválida.");
  return url;
}

async function assertPublicHost(hostname: string) {
  const addresses = await lookup(hostname, { all: true });
  if (!addresses.length || addresses.some((entry) => privateIp(entry.address))) throw new Error("Destino de rede não permitido.");
  return addresses[0];
}

export function sanitizeShopeeProductUrl(value: string) {
  const url = assertAllowedShopeeUrl(value);
  url.hash = "";
  for (const key of Array.from(url.searchParams.keys())) {
    if (TRACKING_PARAMS.some((pattern) => pattern.test(key))) url.searchParams.delete(key);
  }
  return url.toString();
}

export function extractShopeeProductIdentifiers(value: string): ShopeeProductIdentifiers {
  const url = assertAllowedShopeeUrl(value);
  const path = decodeURIComponent(url.pathname);
  const legacy = path.match(/-i\.(\d+)\.(\d+)(?:$|[/?])/i);
  const product = path.match(/\/product\/(\d+)\/(\d+)(?:$|[/?])/i);
  const match = legacy || product;
  return match ? { shopId: match[1], itemId: match[2] } : {};
}

export class ShopeeUrlResolver {
  async resolveUrl(value: string) {
    let current = assertAllowedShopeeUrl(value);
    for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
      const address = await assertPublicHost(current.hostname);
      const httpsAgent = new Agent({ lookup: (_hostname, options, callback) => {
        if (typeof options === "object" && options.all) return callback(null, [address]);
        return callback(null, address.address, address.family);
      } });
      const response = await axios.get(current.toString(), {
        maxRedirects: 0,
        timeout: 7_000,
        responseType: "stream",
        httpsAgent,
        validateStatus: (status) => (status >= 200 && status < 400),
        headers: { "user-agent": "Disparei/1.0 (+https://www.disparei.pro)" }
      });
      response.data?.destroy?.();
      if (response.status < 300) return sanitizeShopeeProductUrl(current.toString());
      const location = response.headers.location;
      if (!location) throw new Error("Redirect Shopee sem destino.");
      current = assertAllowedShopeeUrl(new URL(location, current).toString());
    }
    throw new Error("Limite de redirects Shopee excedido.");
  }
}

export function replaceUrlPreservingText(text: string, original: string, replacement: string) {
  return text.split(original).join(replacement);
}
