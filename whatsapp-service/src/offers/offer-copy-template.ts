/**
 * Fixed WhatsApp offer layout. The AI only extracts facts from the source
 * message; everything shown here (hook, discount, layout) is decided in code,
 * so the copy always has the same shape and never shows a made-up or 0%
 * discount.
 */

/** Hooks that only make sense when a real discount is shown. */
export const DISCOUNT_HOOKS = [
  "CORRE QUE ACABA ⚡️",
  "ESSA LOJA ENLOUQUECEU 🤯",
  "PREÇO DE ERRO?! 😱",
  "BAIXOU MUITO 📉",
  "DESCONTO ABSURDO 🔥",
  "TÁ QUASE DE GRAÇA 🫢",
  "QUEIMA DE PREÇO 🔥",
  "MENOR PREÇO QUE JÁ VI 👀",
  "OLHA ESSE PREÇO 😳",
  "DESPENCOU O PREÇO ⬇️"
];

/** Hooks that fit any offer, with or without discount. */
export const GENERAL_HOOKS = [
  "ACHADINHO DO DIA 🛍️",
  "VOCÊ PRECISA VER ISSO 👀",
  "ACHEI E VIM CORRENDO TE MOSTRAR 🏃‍♀️",
  "OFERTA IMPERDÍVEL 💥",
  "ESSE AQUI VALE A PENA ✨",
  "PARA TUDO E OLHA ISSO 🛑",
  "ACHADO DE HOJE 🎯",
  "SEU BOLSO VAI AGRADECER 💸",
  "OLHA O QUE EU ACHEI 🤩",
  "NÃO DEIXA PASSAR ⏰"
];

/** Below this, "2% DE DESCONTO" hurts more than it helps, so the offer is shown as a plain price. */
export const MIN_DISCOUNT_PERCENT = 5;
/** "PREÇO DE ERRO?!" on a 9% discount sounds fake; below this only the general hooks are used. */
export const STRONG_DISCOUNT_HOOK_PERCENT = 20;
export const OFFER_DISCLAIMER = "⚠️ Promoção sujeita à alteração de preço e estoque do site";

export type OfferCopyFacts = {
  productName: string;
  priceFromCents: number | null;
  priceToCents: number | null;
  /** Payment condition tied to the price, as written in the offer ("no Pix", "à vista"). */
  priceCondition: string | null;
  /** Percent off written in the offer ("50% off"), used only when there is no old price to compute it from. */
  statedDiscountPercent: number | null;
  coupon: string | null;
  extraLines: string[];
};

const BRL_VALUE = /R\$\s*(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d{2}))?|(\d{1,3}(?:\.\d{3})+|\d+),(\d{2})/gi;

function toCents(integerPart: string, cents?: string) {
  return Number(integerPart.replace(/\./g, "")) * 100 + Number(cents || 0);
}

/** Every Brazilian-real amount written in a text ("R$ 55", "R$89,35", "1.299,90"), in cents. */
export function brlAmountsInCents(text: string): number[] {
  const amounts: number[] = [];
  for (const match of text.matchAll(BRL_VALUE)) {
    amounts.push(match[1] !== undefined ? toCents(match[1], match[2]) : toCents(match[3], match[4]));
  }
  return amounts;
}

/** Parses one price as the AI returned it ("89,35", "R$ 1.299,90", "55"). */
export function parseBrlPrice(value: string | null | undefined): number | null {
  if (!value) return null;
  const cleaned = value.trim();
  const [first] = brlAmountsInCents(/^\d/.test(cleaned) && !/,\d{2}\b/.test(cleaned) ? `R$ ${cleaned}` : cleaned);
  return first && first > 0 ? first : null;
}

export function formatBrl(cents: number) {
  return `R$${(cents / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Whole percent off, rounded down so the copy never overstates the discount. */
export function discountPercent(fromCents: number | null, toCents: number | null): number | null {
  if (!fromCents || !toCents || fromCents <= toCents) return null;
  const percent = Math.floor(((fromCents - toCents) / fromCents) * 100);
  return percent >= MIN_DISCOUNT_PERCENT ? percent : null;
}

function pick<T>(items: T[], random: () => number) {
  return items[Math.min(items.length - 1, Math.floor(random() * items.length))];
}

export function buildOfferCopy(facts: OfferCopyFacts, purchaseLink: string, random: () => number = Math.random): string {
  const computed = discountPercent(facts.priceFromCents, facts.priceToCents);
  const statedPercent = facts.statedDiscountPercent;
  const stated = !facts.priceFromCents && facts.priceToCents && statedPercent && statedPercent >= MIN_DISCOUNT_PERCENT && statedPercent < 100
    ? statedPercent : null;
  const shownPercent = computed || stated || 0;
  const hook = pick(shownPercent >= STRONG_DISCOUNT_HOOK_PERCENT ? [...DISCOUNT_HOOKS, ...GENERAL_HOOKS] : GENERAL_HOOKS, random);
  const blocks: string[] = [hook, `🛍️ ${facts.productName}`];

  const condition = facts.priceCondition ? ` ${facts.priceCondition}` : "";
  if (computed && facts.priceFromCents && facts.priceToCents) {
    blocks.push([`😱🔻${computed}% DE DESCONTO`, `De: ${formatBrl(facts.priceFromCents)}`, `Por: ${formatBrl(facts.priceToCents)}${condition} ✅`].join("\n"));
  } else if (stated && facts.priceToCents) {
    blocks.push([`😱🔻${stated}% DE DESCONTO`, `Por: ${formatBrl(facts.priceToCents)}${condition} ✅`].join("\n"));
  } else if (facts.priceToCents) {
    blocks.push(`💰 Por apenas ${formatBrl(facts.priceToCents)}${condition} ✅`);
  }

  if (facts.extraLines.length) blocks.push(["✨ Aproveite também:", ...facts.extraLines.map((line) => `▪️ ${line}`)].join("\n"));
  if (facts.coupon) blocks.push(`🎟️ Use o cupom: ${facts.coupon}`);

  blocks.push(["COMPRE AQUI 👇", `🛒 ${purchaseLink}`].join("\n"), OFFER_DISCLAIMER);
  return blocks.join("\n\n");
}
