import { lookup } from "dns/promises";
import { isIP } from "net";
import { STORE_SHORT_HOSTS, storeOf, type ListStore } from "../link-list";

// Encurtador de loja (s.shopee.com.br, shp.ee, meli.la) -> endereço do produto.
// Só segue redirecionamentos dentro da mesma loja, confere o DNS de cada salto e
// para em 5 saltos (docs/architecture.md, regra 10).

const MAX_REDIRECTS = 5;
const TIMEOUT_MS = 6_000;

export class ShortLinkError extends Error {}

function privateAddress(address: string) {
  if (["127.0.0.1", "::1", "0.0.0.0", "169.254.169.254"].includes(address)) return true;
  if (/^(10|127|192\.168|169\.254)\./.test(address)) return true;
  const private172 = address.match(/^172\.(\d+)\./);
  if (private172 && Number(private172[1]) >= 16 && Number(private172[1]) <= 31) return true;
  return /^(fc|fd|fe80:)/i.test(address);
}

type Lookup = (hostname: string) => Promise<Array<{ address: string }>>;
const defaultLookup: Lookup = hostname => lookup(hostname, { all: true });

export async function resolveStoreShortLink(value: string, store: ListStore, deps: { fetcher?: typeof fetch; lookupHost?: Lookup } = {}) {
  const fetcher = deps.fetcher ?? fetch;
  const lookupHost = deps.lookupHost ?? defaultLookup;
  let url = new URL(value);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    if (url.protocol !== "https:" || url.username || url.password || url.port || isIP(url.hostname) || storeOf(url) !== store) throw new ShortLinkError("O link leva para fora da loja.");
    if (!STORE_SHORT_HOSTS.has(url.hostname.toLowerCase())) return url;
    if (hop === MAX_REDIRECTS) break;
    const addresses = await lookupHost(url.hostname).catch(() => []);
    if (!addresses.length || addresses.some(entry => privateAddress(entry.address))) throw new ShortLinkError("Destino de rede não permitido.");
    let response: Response;
    try { response = await fetcher(url.toString(), { method: "GET", redirect: "manual", signal: AbortSignal.timeout(TIMEOUT_MS), headers: { "user-agent": "Mozilla/5.0 (compatible; Disparei/1.0)" } }); }
    catch { throw new ShortLinkError("Não foi possível abrir o link curto."); }
    response.body?.cancel().catch(() => undefined);
    const location = response.status >= 300 && response.status < 400 ? response.headers.get("location") : null;
    if (!location) throw new ShortLinkError("Não foi possível abrir o link curto.");
    url = new URL(location, url);
  }
  throw new ShortLinkError("O link curto tem redirecionamentos demais.");
}
