// Selos da foto da oferta ("-52%", "FRETE GRÁTIS"): quando mostrar e com qual texto.
// Usado pelo painel (Catálogo) e pelo whatsapp-service (Piloto e card do link), para
// os dois decidirem igual. O desenho do selo fica só no whatsapp-service.
import { MIN_DISCOUNT_PERCENT, discountPercent } from "./offer-copy.mjs";

/** Acima disso o dado da loja quase sempre está errado; melhor não mostrar selo. */
export const MAX_BADGE_DISCOUNT_PERCENT = 95;
export const FREE_SHIPPING_BADGE_TEXT = "FRETE GRÁTIS";
export const OFFER_IMAGE_MODES = ["original_image", "product_link_preview"];
export const DEFAULT_OFFER_IMAGE_SETTINGS = Object.freeze({
  defaultImageMode: "original_image",
  discountBadge: false,
  freeShippingBadge: false
});

const cents = (value) => typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.round(value * 100) : null;

function validPercent(value) {
  if (value === null || value === undefined || value === "") return null;
  const percent = Math.floor(Number(value));
  return Number.isFinite(percent) && percent >= MIN_DISCOUNT_PERCENT && percent <= MAX_BADGE_DISCOUNT_PERCENT ? percent : null;
}

/**
 * Mesma regra da copy: com preço antigo e novo, vale a conta (arredondada para
 * baixo); sem os dois, vale o desconto informado pela loja. Nunca 0%.
 */
export function badgeDiscountPercent({ price, originalPrice, statedDiscountPercent } = {}) {
  const to = cents(price);
  const from = cents(originalPrice);
  if (from && to) return from > to ? validPercent(discountPercent(from, to)) : null;
  return validPercent(statedDiscountPercent);
}

export function decideOfferBadges(facts = {}, settings = DEFAULT_OFFER_IMAGE_SETTINGS) {
  const badges = {};
  if (settings?.discountBadge) {
    const percent = badgeDiscountPercent(facts);
    if (percent) badges.discountPercent = percent;
  }
  if (settings?.freeShippingBadge && facts.freeShipping === true) badges.freeShipping = true;
  return Object.keys(badges).length ? badges : null;
}

/** Selos lidos do banco ou de uma requisição: só passa o que é válido. */
export function sanitizeOfferBadges(value) {
  if (!value || typeof value !== "object") return null;
  const badges = {};
  const percent = validPercent(value.discountPercent);
  if (percent) badges.discountPercent = percent;
  if (value.freeShipping === true) badges.freeShipping = true;
  return Object.keys(badges).length ? badges : null;
}

export function formatDiscountBadge(percent) {
  const valid = validPercent(percent);
  return valid ? `-${valid}%` : null;
}

/** Chave curta para caches (mesma imagem com selos diferentes não pode colidir). */
export function offerBadgesKey(badges) {
  const clean = sanitizeOfferBadges(badges);
  if (!clean) return "none";
  return `${clean.discountPercent ? `d${clean.discountPercent}` : ""}${clean.freeShipping ? "f" : ""}`;
}

// "até 70% off" é faixa da loja, não o desconto deste produto.
const STATED_PERCENT = /(?:^|[^\d])(?<!at[eé]\s)(\d{1,2})\s*%\s*(?:de\s+desconto|off|desc\b)/i;
const MINUS_PERCENT = /(?:^|\s)[-−]\s?(\d{1,2})\s*%/;
const MONEY = String.raw`~?\s*R\$\s*([\d.]+(?:,\d{2})?)\s*~?`;
// "De R$ 100 por R$ 48" na mesma linha, ou "De:" e "Por:" no começo de linhas.
const PRICE_PAIR = new RegExp(String.raw`(?<!(?:acima|partir|m[ií]nimo|compras?|pedidos?|valor)\s)\bde:?\s*${MONEY}[\s,]*(?:\n[^\p{L}\d\n]*)?por:?\s*(?:apenas\s+)?${MONEY}`, "iu");
const PRICE_FROM_LINE = new RegExp(String.raw`^[^\p{L}\d\n]*de:?\s*${MONEY}`, "imu");
const PRICE_TO_LINE = new RegExp(String.raw`^[^\p{L}\d\n]*por:?\s*(?:apenas\s+)?${MONEY}`, "imu");
const FREE_SHIPPING = /frete\s+gr[aá]tis/i;
// "Frete grátis acima de R$ 79", "para membros", "em compras..." não é frete grátis da oferta.
const CONDITIONAL_FREE_SHIPPING = /frete\s+gr[aá]tis[^\n]{0,40}?(acima|a\s+partir|compras?|pedidos?|prime|membros?|assinantes?|cupom|selecionad|regi[aãõ]|capita|at[eé]\s+R\$|m[ií]nimo)/i;

function brl(value) {
  if (!value) return undefined;
  const [integer, fraction] = value.replace(/\./g, "").split(",");
  const parsed = Number(integer) + (fraction ? Number(fraction) / 100 : 0);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

/**
 * Dados de selo escritos no texto da oferta (Piloto). Só o que está explícito:
 * "52% OFF", "-52%", "De R$ 100 por R$ 48" e "frete grátis" sem condição.
 */
export function offerBadgeFactsFromText(text) {
  const value = String(text || "");
  const stated = value.match(STATED_PERCENT)?.[1] || value.match(MINUS_PERCENT)?.[1];
  const pair = value.match(PRICE_PAIR);
  const from = brl(pair?.[1] || value.match(PRICE_FROM_LINE)?.[1]);
  const to = brl(pair?.[2] || value.match(PRICE_TO_LINE)?.[1]);
  return {
    statedDiscountPercent: stated ? Number(stated) : undefined,
    // Sem "De" e "Por" juntos não dá para conferir a conta: fica com o % escrito.
    ...(from && to && !stated ? { originalPrice: from, price: to } : {}),
    freeShipping: FREE_SHIPPING.test(value) && !CONDITIONAL_FREE_SHIPPING.test(value)
  };
}
