import { z } from "zod";
import { brasiliaInstant, everyInterval } from "./schedule-plan";

// Modo Lista: a pessoa cola vários links de produto e o robô agenda um por vez.
// Funções puras, usadas pela tela (contagem e horários) e pelo servidor (validação).

export type ListStore = "SHOPEE" | "MERCADO_LIVRE" | "AMAZON" | "MAGALU";

export const LIST_MAX_LINKS = 50;
/** Links por chamada ao servidor: cada um consulta a loja, então o lote é pequeno. */
export const LIST_RESOLVE_CHUNK = 4;
/** Ofertas por chamada de agendamento (a rota aceita até 10). */
export const LIST_SCHEDULE_CHUNK = 3;
export const LIST_INTERVALS = [2, 5, 10, 15, 20, 30, 45, 60, 90, 120];

const STORE_HOSTS: Array<[ListStore, RegExp]> = [
  ["SHOPEE", /^(?:[a-z0-9-]+\.)*shopee\.com\.br$|^shp\.ee$|^shope\.ee$/],
  ["MERCADO_LIVRE", /^(?:[a-z0-9-]+\.)*mercadolivre\.com\.br$|^meli\.la$/],
  // Mesmos domínios aceitos pelo conversor da Amazon (packages/affiliate-links/amazon.mjs).
  ["AMAZON", /^(?:www\.)?amazon\.com\.br$|^amzn\.to$|^a\.co$|^link\.amazon$|^amzlink\.me$|^amzlinks\.in$|^amzn\.divulgador\.link$/],
  ["MAGALU", /^(?:www\.)?magazinevoce\.com\.br$|^(?:www\.)?magazineluiza\.com\.br$/]
];

/** Encurtadores das lojas: o produto só aparece depois de seguir o redirecionamento. */
export const STORE_SHORT_HOSTS = new Set(["s.shopee.com.br", "shp.ee", "shope.ee", "meli.la"]);

export const STORE_LABEL: Record<ListStore, string> = { SHOPEE: "Shopee", MERCADO_LIVRE: "Mercado Livre", AMAZON: "Amazon", MAGALU: "Magalu" };

export function storeOf(value: string | URL): ListStore | null {
  let url: URL;
  try { url = typeof value === "string" ? new URL(value) : value; } catch { return null; }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const host = url.hostname.toLowerCase();
  return STORE_HOSTS.find(([, pattern]) => pattern.test(host))?.[0] ?? null;
}

// Começa em http(s):// ou www., ou direto no domínio de uma loja (quem copia do WhatsApp às vezes perde o https).
const LINK_PATTERN = /(?:https?:\/\/|www\.)[^\s<>"'`]+|\b(?:[a-z0-9-]+\.)*(?:shopee\.com\.br|shp\.ee|shope\.ee|mercadolivre\.com\.br|meli\.la|amazon\.com\.br|amzn\.to|a\.co|magazinevoce\.com\.br|magazineluiza\.com\.br)\/[^\s<>"'`]*/gi;
// Pontuação e formatação do WhatsApp (*negrito*, _itálico_, ~riscado~) grudadas no fim do link.
const TRAILING = /[).,;:!?*_~\]}>]+$/;

function normalizeLink(raw: string) {
  let value = raw.replace(TRAILING, "");
  if (!/^https?:\/\//i.test(value)) value = `https://${value}`;
  try {
    const url = new URL(value);
    url.protocol = "https:";
    url.hash = "";
    return url;
  } catch { return null; }
}

/** Código do produto dentro do endereço, quando dá para saber sem abrir a página. */
export function productIdFromUrl(store: ListStore, value: string | URL): string | null {
  let url: URL;
  try { url = typeof value === "string" ? new URL(value) : value; } catch { return null; }
  let path = url.pathname;
  try { path = decodeURIComponent(path); } catch { /* endereço com % solto: usa como veio */ }
  if (store === "SHOPEE") return path.match(/-i\.\d+\.(\d+)/)?.[1] ?? path.match(/^\/product\/\d+\/(\d+)/)?.[1] ?? path.match(/^\/[^/]+\/\d+\/(\d+)\/?$/)?.[1] ?? null;
  if (store === "AMAZON") return path.match(/\/(?:dp|gp\/product|gp\/aw\/d)\/([A-Z0-9]{10})(?:[/?#]|$)/i)?.[1]?.toUpperCase() ?? null;
  if (store === "MAGALU") return path.match(/\/p\/([a-z0-9]{6,})(?:\/|$)/i)?.[1]?.toLowerCase() ?? null;
  const fromFilter = url.searchParams.get("pdp_filters")?.match(/item_id:MLB-?(\d{6,})/i)?.[1];
  const fromPath = path.match(/\bMLB-?(\d{6,})\b/i)?.[1];
  return fromFilter ? `MLB${fromFilter}` : fromPath ? `MLB${fromPath}` : null;
}

/** Mesma oferta com endereços diferentes (com e sem rastreio, www etc.) conta uma vez só. */
export function linkKey(url: URL): string {
  const store = storeOf(url);
  const id = store && !STORE_SHORT_HOSTS.has(url.hostname.toLowerCase()) ? productIdFromUrl(store, url) : null;
  if (store && id) return `${store}:${id}`;
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  return `${host}${url.pathname.replace(/\/+$/, "")}${STORE_SHORT_HOSTS.has(host) ? "" : url.search}`;
}

export type ExtractedLinks = { links: string[]; repeated: number; overLimit: number };

/** Acha os links no texto colado (um por linha ou misturado com a copy), sem repetir, até o limite. */
export function extractProductLinks(text: string, max = LIST_MAX_LINKS): ExtractedLinks {
  const seen = new Set<string>();
  const links: string[] = [];
  let repeated = 0;
  let overLimit = 0;
  for (const match of text.matchAll(LINK_PATTERN)) {
    const url = normalizeLink(match[0]);
    if (!url) continue;
    const key = linkKey(url);
    if (seen.has(key)) { repeated += 1; continue; }
    seen.add(key);
    if (links.length >= max) { overLimit += 1; continue; }
    links.push(url.toString());
  }
  return { links, repeated, overLimit };
}

/** Nome provisório tirado do endereço (ex.: /fone-bluetooth-x/p/MLB123 vira "Fone bluetooth x"). */
export function nameFromUrl(store: ListStore, value: string): string | null {
  let url: URL;
  try { url = new URL(value); } catch { return null; }
  let path = url.pathname;
  try { path = decodeURIComponent(path); } catch { /* mantém */ }
  const segments = path.split("/").filter(Boolean);
  let slug: string | undefined;
  if (store === "SHOPEE") slug = segments.find(segment => /-i\.\d+\.\d+/.test(segment))?.replace(/-i\.\d+\.\d+.*$/, "");
  else if (store === "AMAZON") { const dp = segments.findIndex(segment => segment === "dp" || segment === "gp"); slug = dp > 0 ? segments[dp - 1] : undefined; }
  else if (store === "MAGALU") { const p = segments.indexOf("p"); slug = p > 0 ? segments[p - 1] : undefined; if (slug && /^magazine/i.test(slug) && p === 1) slug = undefined; }
  else slug = segments.find(segment => /[a-z]-[a-z]/i.test(segment) && !/^MLB/i.test(segment))?.replace(/^MLB-?\d+-/i, "").replace(/-_JM$/i, "");
  if (!slug) return null;
  const words = slug.replace(/[-_+]+/g, " ").replace(/\s+/g, " ").trim();
  if (words.length < 4 || !/[a-zà-ú]{3}/i.test(words)) return null;
  return (words.charAt(0).toUpperCase() + words.slice(1).toLowerCase()).slice(0, 200);
}

export type ListStart = { mode: "now" } | { mode: "at"; day: string; time: string };

/**
 * Horário de cada oferta da lista, uma a cada `intervalMinutes`.
 * "Agora" começa daqui a 1 minuto; horário escolhido que já passou começa em agora + 5 min.
 */
export function listSlots(count: number, start: ListStart, intervalMinutes: number, now: Date = new Date()): Date[] {
  if (count < 1 || intervalMinutes < 1) return [];
  if (start.mode === "at") return everyInterval(count, start.day, start.time, intervalMinutes, now);
  const first = Math.ceil((now.getTime() + 60_000) / 60_000) * 60_000;
  return Array.from({ length: count }, (_, index) => new Date(first + index * intervalMinutes * 60_000));
}

/** Horário escolhido inválido (data ou hora mal formada). */
export function isValidListStart(start: ListStart) {
  if (start.mode === "now") return true;
  return /^\d{4}-\d{2}-\d{2}$/.test(start.day) && /^\d{2}:\d{2}$/.test(start.time) && !Number.isNaN(brasiliaInstant(start.day, start.time).getTime());
}

export const listResolveSchema = z.object({
  links: z.array(z.string().trim().min(8).max(2000)).min(1, "Cole ao menos um link.").max(LIST_RESOLVE_CHUNK, "Envie no máximo 4 links por vez.")
});
