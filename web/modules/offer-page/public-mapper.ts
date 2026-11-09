import {
  extractOfferLink, extractPrices, extractTitle, offerDiscount, OFFER_PAGE_STORES, STORE_LABELS, storeOfUrl, titleKey,
  type OfferPageStore
} from "./offer-text";

// Única ponte entre o banco e a página pública: tudo o que sai daqui vai para o
// navegador de qualquer visitante. Só campos de lista branca; nunca conta,
// grupo, número, texto da mensagem nem caminhos do Storage.

export const OFFER_PAGE_MAX_ITEMS = 60;
export const OFFER_PAGE_WINDOW_DAYS = 30;

export type OfferPageRow = {
  product_key?: string | null;
  store?: string | null;
  link?: string | null;
  message?: string | null;
  title?: string | null;
  price?: number | string | null;
  original_price?: number | string | null;
  image_url?: string | null;
  sent_at?: string | null;
};

export type PublicOfferItem = {
  id: string;
  title: string;
  store: OfferPageStore;
  storeLabel: string;
  link: string;
  imageUrl: string | null;
  priceCents: number | null;
  oldPriceCents: number | null;
  discountPercent: number | null;
  sentAt: string;
};

export type PublicOfferPage = {
  slug: string;
  title: string;
  bio: string;
  avatarUrl: string | null;
  stores: OfferPageStore[];
  items: PublicOfferItem[];
};

const toCents = (value: number | string | null | undefined) => {
  const number = typeof value === "string" ? Number(value) : value;
  return typeof number === "number" && Number.isFinite(number) && number > 0 ? Math.round(number * 100) : null;
};

function safeHttpsUrl(value: string | null | undefined, maxLength = 1000) {
  if (!value || value.length > maxLength) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url.toString() : null;
  } catch { return null; }
}

// Identificador estável e curto, sem expor a chave interna do produto.
function shortId(value: string) {
  let hash = 2166136261;
  for (const char of value) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return (hash >>> 0).toString(36);
}

export function toPublicItem(row: OfferPageRow): PublicOfferItem | null {
  // O link mostrado é o que foi enviado: o salvo na linha, conferido de novo pela allowlist.
  const link = row.link && storeOfUrl(row.link) ? row.link : extractOfferLink(row.message);
  if (!link) return null;
  const store = (OFFER_PAGE_STORES as readonly string[]).includes(row.store || "") ? row.store as OfferPageStore : storeOfUrl(link);
  if (!store) return null;
  const parsed = row.price == null ? extractPrices(row.message) : null;
  const priceCents = toCents(row.price) ?? parsed?.priceCents ?? null;
  let oldPriceCents = toCents(row.original_price) ?? (row.price == null ? parsed?.oldPriceCents ?? null : null);
  if (oldPriceCents !== null && (priceCents === null || oldPriceCents <= priceCents)) oldPriceCents = null;
  const title = (row.title?.trim() ? row.title.trim().slice(0, 110) : null) || extractTitle(row.message) || `Oferta ${STORE_LABELS[store]}`;
  const sentAt = row.sent_at && !Number.isNaN(Date.parse(row.sent_at)) ? new Date(row.sent_at).toISOString() : new Date(0).toISOString();
  return {
    id: shortId(`${row.product_key || ""}|${link}`),
    title,
    store,
    storeLabel: STORE_LABELS[store],
    link,
    imageUrl: safeHttpsUrl(row.image_url),
    priceCents,
    oldPriceCents,
    discountPercent: offerDiscount(priceCents, oldPriceCents),
    sentAt
  };
}

/** Mais novo primeiro, um card por produto (mesmo link ou mesmo nome na mesma loja), até 60. */
export function toPublicItems(rows: OfferPageRow[], options: { stores?: readonly string[]; now?: Date; max?: number } = {}) {
  const since = (options.now || new Date()).getTime() - OFFER_PAGE_WINDOW_DAYS * 86_400_000;
  const allowed = options.stores?.length ? new Set(options.stores) : null;
  const max = options.max ?? OFFER_PAGE_MAX_ITEMS;
  const items = rows
    .map(toPublicItem)
    .filter((item): item is PublicOfferItem => Boolean(item) && Date.parse(item!.sentAt) >= since && (!allowed || allowed.has(item!.store)))
    .sort((a, b) => Date.parse(b.sentAt) - Date.parse(a.sentAt));
  const seen = new Set<string>();
  const result: PublicOfferItem[] = [];
  for (const item of items) {
    const keys = [`link:${item.link}`, titleKey(item.store, item.title)];
    if (keys.some((key) => seen.has(key))) continue;
    keys.forEach((key) => seen.add(key));
    result.push(item);
    if (result.length >= max) break;
  }
  return result;
}

export function normalizeStores(value: unknown): OfferPageStore[] {
  const list = Array.isArray(value) ? value : [];
  return OFFER_PAGE_STORES.filter((store) => list.includes(store));
}

export function toPublicPage(raw: {
  slug?: unknown; title?: unknown; bio?: unknown; stores?: unknown; items?: unknown;
}, avatarUrl: string | null, now?: Date): PublicOfferPage | null {
  if (!raw || typeof raw.slug !== "string") return null;
  const stores = normalizeStores(raw.stores);
  return {
    slug: raw.slug,
    title: typeof raw.title === "string" && raw.title.trim() ? raw.title.trim().slice(0, 60) : "Minhas ofertas",
    bio: typeof raw.bio === "string" ? raw.bio.trim().slice(0, 140) : "",
    avatarUrl: safeHttpsUrl(avatarUrl, 4000),
    stores,
    items: toPublicItems(Array.isArray(raw.items) ? raw.items as OfferPageRow[] : [], { stores, now })
  };
}

export function formatPrice(cents: number) {
  return `R$ ${(cents / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
