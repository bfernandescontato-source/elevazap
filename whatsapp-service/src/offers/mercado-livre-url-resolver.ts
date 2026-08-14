import axios from "axios";
import { lookup } from "dns/promises";
import { Agent } from "https";
import { isIP } from "net";
import type { ResolvedAffiliateProduct } from "./types.js";

const ALLOWED_HOSTS = new Set([
  "mercadolivre.com.br", "www.mercadolivre.com.br", "produto.mercadolivre.com.br", "meli.la"
]);
const MAX_REDIRECTS = 5;
const TRACKING_PARAMS = [/^utm_/i, /^matt_/i, /^mc_/i, /^fbclid$/i, /^gclid$/i, /^source$/i, /^tracking_id$/i];

function isPrivateAddress(address: string) {
  if (["127.0.0.1", "::1", "0.0.0.0", "169.254.169.254"].includes(address)) return true;
  if (/^(10|192\.168|169\.254)\./.test(address)) return true;
  const private172 = address.match(/^172\.(\d+)\./);
  if (private172 && Number(private172[1]) >= 16 && Number(private172[1]) <= 31) return true;
  return /^(fc|fd|fe80:)/i.test(address);
}

export function assertAllowedMercadoLivreUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== "https:" || !ALLOWED_HOSTS.has(url.hostname.toLowerCase())) throw new Error("URL Mercado Livre não permitida.");
  if (isIP(url.hostname) || url.username || url.password || url.port) throw new Error("URL Mercado Livre inválida.");
  return url;
}

async function resolvePublicAddress(hostname: string) {
  const addresses = await lookup(hostname, { all: true });
  if (!addresses.length || addresses.some(({ address }) => isPrivateAddress(address))) throw new Error("Destino de rede não permitido.");
  return addresses[0];
}

export function sanitizeMercadoLivreProductUrl(value: string) {
  const url = assertAllowedMercadoLivreUrl(value);
  url.hash = "";
  for (const key of Array.from(url.searchParams.keys())) {
    if (TRACKING_PARAMS.some((pattern) => pattern.test(key))) url.searchParams.delete(key);
  }
  return url.toString();
}

export function extractMercadoLivreProductIdentifiers(value: string) {
  const url = assertAllowedMercadoLivreUrl(value);
  const path = decodeURIComponent(url.pathname);
  const itemFromPath = path.match(/\bMLB-?(\d{6,})\b/i)?.[1];
  const itemFromFilter = url.searchParams.get("pdp_filters")?.match(/item_id:MLB(\d{6,})/i)?.[1];
  const catalogProductId = path.match(/\/p\/MLB(\d{6,})(?:\/|$)/i)?.[1];
  return {
    itemId: itemFromFilter ? `MLB${itemFromFilter}` : itemFromPath ? `MLB${itemFromPath}` : undefined,
    catalogProductId: catalogProductId ? `MLB${catalogProductId}` : undefined
  };
}

export class MercadoLivreUrlResolver {
  async resolveUrl(originalUrl: string): Promise<ResolvedAffiliateProduct> {
    let current = assertAllowedMercadoLivreUrl(originalUrl);
    for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
      const address = await resolvePublicAddress(current.hostname);
      const httpsAgent = new Agent({ lookup: (_hostname, options, callback) => {
        if (typeof options === "object" && options.all) return callback(null, [address]);
        return callback(null, address.address, address.family);
      } });
      const response = await axios.get(current.toString(), {
        maxRedirects: 0, timeout: 7_000, responseType: "stream", httpsAgent,
        validateStatus: (status) => status >= 200 && status < 400,
        headers: { "user-agent": "Disparei/1.0 (+https://www.disparei.pro)" }
      });
      response.data?.destroy?.();
      if (response.status < 300) {
        const resolvedUrl = sanitizeMercadoLivreProductUrl(current.toString());
        return { provider: "mercado_livre", originalUrl, resolvedUrl, ...extractMercadoLivreProductIdentifiers(resolvedUrl) };
      }
      const location = response.headers.location;
      if (!location) throw new Error("Redirect Mercado Livre sem destino.");
      current = assertAllowedMercadoLivreUrl(new URL(location, current).toString());
    }
    throw new Error("Limite de redirects Mercado Livre excedido.");
  }
}
