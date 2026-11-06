/**
 * Conteúdo do story 9:16 de uma oferta (sem desenho): textos, preços e quebra
 * do título. Fica separado do desenho para ser testado sem gerar imagem.
 */

export const STORY_WIDTH = 1080;
export const STORY_HEIGHT = 1920;
/** Desconto abaixo disso não vira selo: costuma ser arredondamento da loja. */
export const MIN_REAL_DISCOUNT = 5;
export const TITLE_MAX_LINES = 3;

/**
 * Frase curta impressa na arte. O link não é clicável numa imagem, nem no
 * Status do WhatsApp nem no Stories do Instagram; responder o story abre uma
 * conversa no privado nos dois apps, então a chamada pede isso.
 */
export const STORY_CTA = "Peça o link no privado";

export type StoryOfferInput = {
  provider: string;
  name: string;
  priceMin?: number;
  originalPrice?: number;
  discountPercentage?: number;
  shopName?: string;
  affiliateUrl?: string;
};

export type StoryModel = {
  storeLabel: string;
  titleLines: string[];
  oldPrice: string | null;
  newPrice: string | null;
  discountLabel: string | null;
  cta: string;
  linkLabel: string | null;
};

const STORE_LABELS: Record<string, string> = {
  SHOPEE: "Shopee",
  MERCADO_LIVRE: "Mercado Livre",
  AMAZON: "Amazon",
  MAGALU: "Magalu",
  TIKTOK_SHOP: "TikTok Shop"
};

/** "R$ 1.299,90" com espaço comum (o Intl usa espaço especial, que varia por versão). */
export function formatBRL(value: number): string {
  const cents = Math.round(value * 100);
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const integer = Math.floor(abs / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const decimals = String(abs % 100).padStart(2, "0");
  return `${negative ? "-" : ""}R$ ${integer},${decimals}`;
}

/** Desconto que de fato existe entre o preço antigo e o atual (arredondado). */
export function realDiscount(price?: number, original?: number): number | null {
  if (!price || !original || !Number.isFinite(price) || !Number.isFinite(original) || original <= price || price <= 0) return null;
  const percent = Math.round(((original - price) / original) * 100);
  return percent >= MIN_REAL_DISCOUNT ? percent : null;
}

/**
 * Quebra por palavras em no máximo `maxLines` linhas de até `maxChars`.
 * Palavra maior que a linha é cortada; o que sobra vira "…" no fim da última.
 */
export function wrapTitle(title: string, maxChars: number, maxLines = TITLE_MAX_LINES): string[] {
  const words = title.replace(/\s+/g, " ").trim().split(" ").filter(Boolean)
    .flatMap(word => word.length <= maxChars ? [word] : word.match(new RegExp(`.{1,${maxChars}}`, "g")) || []);
  const lines: string[] = [];
  let current = "";
  let index = 0;
  for (; index < words.length; index++) {
    const word = words[index];
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= maxChars) { current = candidate; continue; }
    lines.push(current);
    current = word;
    if (lines.length === maxLines) break;
  }
  if (lines.length < maxLines && current) { lines.push(current); index = words.length; }
  if (index < words.length) {
    const last = lines[maxLines - 1];
    const room = maxChars - 1;
    lines[maxLines - 1] = `${last.length > room ? last.slice(0, room).trimEnd() : last}…`;
  }
  return lines;
}

/**
 * Link curto o bastante para ser digitado a partir da arte (s.shopee.com.br/x,
 * meli.la/x). Links longos (Amazon com tag) não aparecem: ficariam ilegíveis.
 */
export function shortLinkLabel(url?: string, maxLength = 34): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || parsed.search || parsed.hash) return null;
    const label = `${parsed.hostname.replace(/^www\./, "")}${parsed.pathname === "/" ? "" : parsed.pathname}`;
    return label.length <= maxLength ? label : null;
  } catch { return null; }
}

export function buildStoryModel(offer: StoryOfferInput, titleMaxChars = 24): StoryModel {
  const discount = realDiscount(offer.priceMin, offer.originalPrice);
  return {
    storeLabel: STORE_LABELS[offer.provider] || offer.shopName || "Oferta",
    titleLines: wrapTitle(offer.name, titleMaxChars),
    oldPrice: discount !== null ? formatBRL(offer.originalPrice!) : null,
    newPrice: offer.priceMin && offer.priceMin > 0 ? formatBRL(offer.priceMin) : null,
    discountLabel: discount !== null ? `-${discount}%` : null,
    cta: STORY_CTA,
    linkLabel: shortLinkLabel(offer.affiliateUrl)
  };
}

/** Texto dentro de marcação Pango (o desenhista de texto do sharp). */
export function escapeMarkup(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

export function storyFileName(offer: { provider: string; externalItemId: string }) {
  return `story-${offer.provider.toLowerCase()}-${offer.externalItemId.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 40) || "oferta"}.jpg`;
}
