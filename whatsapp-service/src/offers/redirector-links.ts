import { isSupportedMarketplaceUrl } from "./offer-parser.js";

// Encurtadores que escondem o link do marketplace numa página com
// window.location.replace(atob("...")), sem redirecionamento HTTP. Sem abrir a
// página, o Piloto só enxerga o link do cupom e descarta a oferta.
const REDIRECTOR_HOSTS = new Set(["ofertou.me", "www.ofertou.me"]);
const URL_PATTERN = /https?:\/\/[^\s<>"']+/gi;
const TIMEOUT_MS = 5_000;

function isRedirector(value: string) {
  try { return REDIRECTOR_HOSTS.has(new URL(value).hostname.toLowerCase()); }
  catch { return false; }
}

export function extractRedirectTarget(html: string): string | undefined {
  const encoded = html.match(/atob\(\s*["']([A-Za-z0-9+/=]+)["']\s*\)/)?.[1];
  const candidates = [
    encoded ? Buffer.from(encoded, "base64").toString("utf8") : undefined,
    html.match(/location(?:\.href)?\s*(?:=|\.replace\()\s*["'](https?:\/\/[^"']+)["']/)?.[1],
    html.match(/http-equiv=["']refresh["'][^>]*url=([^"'>\s]+)/i)?.[1]
  ];
  return candidates.find((value): value is string => Boolean(value) && isSupportedMarketplaceUrl(value!.trim()))?.trim();
}

async function resolveRedirector(url: string, fetcher: typeof fetch) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetcher(url, { redirect: "follow", signal: controller.signal, headers: { "user-agent": "Mozilla/5.0" } });
    if (isSupportedMarketplaceUrl(response.url)) return response.url;
    if (!response.ok) return undefined;
    return extractRedirectTarget((await response.text()).slice(0, 200_000));
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

/** Troca links de encurtadores conhecidos pelo link real do marketplace; os que não abrirem ficam como estão. */
export async function expandRedirectorLinks(text: string | undefined, fetcher: typeof fetch = fetch) {
  if (!text) return text;
  const found = Array.from(new Set((text.match(URL_PATTERN) || []).map((value) => value.replace(/[),.!?;:]+$/g, "")).filter(isRedirector)));
  let result = text;
  for (const url of found) {
    const target = await resolveRedirector(url, fetcher);
    if (target) result = result.split(url).join(target);
  }
  return result;
}
