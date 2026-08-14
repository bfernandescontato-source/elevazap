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

function findBalancedJson(text: string, startIndex: number): string | undefined {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = startIndex; i < text.length; i += 1) {
    const char = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === "\"") inString = false;
      continue;
    }
    if (char === "\"") { inString = true; continue; }
    if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(startIndex, i + 1);
    }
  }
  return undefined;
}

/**
 * Páginas de vitrine social (/social/<usuario>) embutem um produto em destaque
 * (o item específico que gerou o link compartilhado) dentro do bloco de estado
 * server-rendered `_n.ctx.r=`, marcado com `id: "card-featured"`. O restante do
 * bloco é o carrossel de recomendações genéricas, sem relação com o link original.
 */
export function extractFeaturedSocialProduct(html: string): { itemId?: string; catalogProductId?: string; url: string } | undefined {
  const marker = "_n.ctx.r=";
  const markerIndex = html.indexOf(marker);
  if (markerIndex === -1) return undefined;
  const jsonStart = html.indexOf("{", markerIndex + marker.length);
  if (jsonStart === -1) return undefined;
  const jsonText = findBalancedJson(html, jsonStart);
  if (!jsonText) return undefined;
  let parsed: unknown;
  try { parsed = JSON.parse(jsonText); } catch { return undefined; }
  const components = (parsed as { appProps?: { pageProps?: { data?: { components?: unknown[] } } } })
    ?.appProps?.pageProps?.data?.components;
  if (!Array.isArray(components)) return undefined;
  const featured = components.find((component) => (component as { id?: string })?.id === "card-featured") as
    { recommendation_data?: { recommendation_info?: { polycards?: Array<{ metadata?: Record<string, unknown> }> } } } | undefined;
  const metadata = featured?.recommendation_data?.recommendation_info?.polycards?.[0]?.metadata;
  const rawUrl = typeof metadata?.url === "string" ? metadata.url : undefined;
  if (!rawUrl) return undefined;
  const itemId = typeof metadata?.id === "string" && /^MLB\d{6,}$/i.test(metadata.id) ? metadata.id : undefined;
  const catalogProductId = typeof metadata?.product_id === "string" && /^MLB\d{6,}$/i.test(metadata.product_id) ? metadata.product_id : undefined;
  if (!itemId && !catalogProductId) return undefined;
  return { itemId, catalogProductId, url: rawUrl.startsWith("http") ? rawUrl : `https://${rawUrl}` };
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
        maxRedirects: 0, timeout: 7_000, responseType: "text", httpsAgent,
        maxContentLength: 6_000_000, maxBodyLength: 6_000_000,
        validateStatus: (status) => status >= 200 && status < 400,
        headers: { "user-agent": "Disparei/1.0 (+https://www.disparei.pro)" }
      });
      if (response.status < 300) {
        const resolvedUrl = sanitizeMercadoLivreProductUrl(current.toString());
        const identifiers = extractMercadoLivreProductIdentifiers(resolvedUrl);
        if (identifiers.itemId || identifiers.catalogProductId) {
          return { provider: "mercado_livre", originalUrl, resolvedUrl, ...identifiers };
        }
        if (new URL(resolvedUrl).pathname.startsWith("/social/")) {
          const featured = extractFeaturedSocialProduct(typeof response.data === "string" ? response.data : "");
          if (!featured) throw new Error("Vitrine do Mercado Livre sem produto em destaque identificável.");
          const featuredUrl = sanitizeMercadoLivreProductUrl(assertAllowedMercadoLivreUrl(featured.url).toString());
          return {
            provider: "mercado_livre", originalUrl, resolvedUrl: featuredUrl,
            itemId: featured.itemId, catalogProductId: featured.catalogProductId
          };
        }
        return { provider: "mercado_livre", originalUrl, resolvedUrl, ...identifiers };
      }
      const location = response.headers.location;
      if (!location) throw new Error("Redirect Mercado Livre sem destino.");
      current = assertAllowedMercadoLivreUrl(new URL(location, current).toString());
    }
    throw new Error("Limite de redirects Mercado Livre excedido.");
  }
}
