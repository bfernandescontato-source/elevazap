import { brlAmountsInCents, discountPercent } from "@disparei/affiliate-links/offer-copy";

// Leitura da mensagem que a conta enviou ao grupo: link de compra, nome do
// produto e preços. Serve para ofertas do Piloto e envios manuais, que não têm
// os dados do produto guardados à parte (o Catálogo tem).

export const OFFER_PAGE_STORES = ["SHOPEE", "MERCADO_LIVRE", "AMAZON", "MAGALU"] as const;
export type OfferPageStore = typeof OFFER_PAGE_STORES[number];

export const STORE_LABELS: Record<OfferPageStore, string> = {
  SHOPEE: "Shopee",
  MERCADO_LIVRE: "Mercado Livre",
  AMAZON: "Amazon",
  MAGALU: "Magalu"
};

const AMAZON_SHORT_HOSTS = new Set(["amzn.to", "a.co", "link.amazon", "amzlink.me", "amzlinks.in", "amzn.divulgador.link"]);

/** Mesma allowlist de public.offer_page_store_of no banco. Só https. */
export function storeOfUrl(value: string): OfferPageStore | null {
  let url: URL;
  try { url = new URL(value); } catch { return null; }
  if (url.protocol !== "https:" || url.username || url.password) return null;
  const host = url.hostname.toLowerCase();
  if (/(^|\.)shopee\.com\.br$/.test(host) || host === "shp.ee" || host === "shope.ee") return "SHOPEE";
  if (/(^|\.)mercadolivre\.com\.br$/.test(host) || host === "meli.la") return "MERCADO_LIVRE";
  if (/(^|\.)amazon\.com\.br$/.test(host) || AMAZON_SHORT_HOSTS.has(host)) return "AMAZON";
  if (/(^|\.)(magazinevoce|magazineluiza)\.com\.br$/.test(host) || /(^|\.)magalu\.com$/.test(host)) return "MAGALU";
  return null;
}

const URL_PATTERN = /https:\/\/[^\s<>"']+/gi;
const trimUrl = (value: string) => value.replace(/[),.!?;:*_~]+$/g, "");

/** Primeiro link de loja conhecida, exatamente como foi enviado. */
export function extractOfferLink(text: string | null | undefined): string | null {
  for (const match of String(text || "").match(URL_PATTERN) || []) {
    const url = trimUrl(match);
    if (storeOfUrl(url)) return url;
  }
  return null;
}

const ANY_URL = /https?:\/\/\S+/gi;
const HAS_URL = /https?:\/\//i;
// Sequências que parecem telefone (10+ dígitos com separadores) nunca vão para a página.
const PHONE_LIKE = /\+?\d[\d\s().-]{8,}\d/g;
const WA_FORMAT = /[*_~`]/g;
const LEADING_SYMBOLS = /^[^\p{L}\p{N}]+/u;
const TRAILING_SYMBOLS = /[^\p{L}\p{N})%]+$/u;
const PRICE_LINE = /R\$|\b\d{1,3}(?:\.\d{3})*,\d{2}\b/;
const NOT_A_TITLE = /^(compre|link|cupom|use o cupom|aproveite|frete|promo[cç][aã]o sujeita|oferta v[aá]lida|garanta|clique|corre|⚠)/i;

export function cleanTitle(value: string) {
  const cleaned = value
    .replace(ANY_URL, " ")
    .replace(WA_FORMAT, "")
    .replace(PHONE_LIKE, " ")
    .replace(LEADING_SYMBOLS, "")
    .replace(TRAILING_SYMBOLS, "")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.length > 110 ? `${cleaned.slice(0, 107).trimEnd()}...` : cleaned;
}

function isShouting(line: string) {
  const letters = line.replace(/[^\p{L}]/gu, "");
  return letters.length >= 4 && letters === letters.toLocaleUpperCase("pt-BR");
}

/** Nome do produto: a linha "🛍️ ..." do modelo fixo ou a primeira linha que pareça um nome. */
export function extractTitle(text: string | null | undefined): string | null {
  const lines = String(text || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const marked = lines.find((line) => /^🛍/u.test(line));
  if (marked) {
    const title = cleanTitle(marked);
    if (title.length >= 3) return title;
  }
  for (const line of lines) {
    if (HAS_URL.test(line) || PRICE_LINE.test(line) || isShouting(line)) continue;
    const title = cleanTitle(line);
    if (title.length < 6 || NOT_A_TITLE.test(title) || !/\p{L}{3,}/u.test(title)) continue;
    return title;
  }
  return null;
}

export type ParsedPrices = { priceCents: number | null; oldPriceCents: number | null };

const SKIP_PRICE_LINE = /cupom|off\b|frete|cashback|desconto de r\$|economi/i;

/** "De: ~R$ 199,90~" e "Por: R$ 99,90" do modelo fixo; senão os dois primeiros valores do texto. */
export function extractPrices(text: string | null | undefined): ParsedPrices {
  const lines = String(text || "").replace(ANY_URL, " ").split(/\r?\n/);
  let priceCents: number | null = null;
  let oldPriceCents: number | null = null;
  const loose: number[] = [];
  for (const line of lines) {
    const amounts = brlAmountsInCents(line).filter((value) => value > 0);
    if (!amounts.length || SKIP_PRICE_LINE.test(line)) continue;
    if (/\bde\b\s*:?\s*~|\bde\s*:/i.test(line) || /~[^~]*\d[^~]*~/.test(line)) {
      oldPriceCents ??= amounts[0];
      if (amounts.length > 1 && /\bpor\b/i.test(line)) priceCents ??= amounts[amounts.length - 1];
    } else if (/\b(por|agora|apenas|só|pre[cç]o)\b/i.test(line)) {
      priceCents ??= amounts[amounts.length - 1];
      if (amounts.length > 1 && /\bde\b/i.test(line)) oldPriceCents ??= amounts[0];
    } else loose.push(...amounts);
  }
  if (priceCents === null && loose.length) {
    const [first, second] = loose;
    if (second !== undefined && second !== first) {
      priceCents = Math.min(first, second);
      oldPriceCents ??= Math.max(first, second);
    } else priceCents = first;
  }
  if (priceCents !== null && oldPriceCents !== null && oldPriceCents <= priceCents) oldPriceCents = null;
  return { priceCents, oldPriceCents };
}

export function offerDiscount(priceCents: number | null, oldPriceCents: number | null) {
  return discountPercent(oldPriceCents, priceCents);
}

/** Chave de produto para juntar o mesmo item enviado com links diferentes. */
export function titleKey(store: string, title: string) {
  const normalized = title.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  return `${store}:${normalized}`;
}
