import OpenAI from "openai";
import { z } from "zod";
import { brlAmountsInCents, buildOfferCopy, parseBrlPrice, type OfferCopyFacts } from "./offer-copy-template.js";

const ExtractedOffer = z.object({
  product_name: z.string(),
  price_from: z.string().nullable(),
  price_to: z.string().nullable(),
  price_condition: z.string().nullable(),
  discount_percent: z.number().nullable(),
  coupon: z.string().nullable(),
  extra_lines: z.array(z.string())
});
type ExtractedOffer = z.infer<typeof ExtractedOffer>;

const URL_PATTERN = /https?:\/\/[^\s<>"']+/gi;
const HAS_URL = /https?:\/\//i;
const NUMBER_FACT = /\d+(?:[.,]\d+)*%?/g;
const MAX_EXTRA_LINES = 4;
const COUPON_CODE = /^[A-Z0-9][A-Z0-9_-]{2,24}$/i;
/** A money amount written without "R$" ("26,91 na recorrência"). */
const BARE_BRL_AMOUNT = /(?<!R\$\s?)(?<![\d.,])(\d{1,3}(?:\.\d{3})*,\d{2})(?![\d%])/g;

export type RewriteInput = {
  text: string;
  purchaseLink?: string | null;
  links: string[];
};

export type RewriteResult = { text: string; model: string };

type ResponsesClient = Pick<OpenAI, "responses">;

const SOURCE_PROMOTION_PATTERN = /(?:nos\s+siga|siga\s+(?:nosso|a\s+gente|no|na)|instagram|chame\s+(?:suas?|os?)\s+amig|entre\s+no\s+(?:nosso\s+)?grupo|acompanhe\s+(?:nosso|a\s+gente))/i;

export function sanitizeSourcePromotion(text: string, purchaseLink?: string | null) {
  const withoutPromotion = text
    .split(/\n\s*\n/)
    .filter((block) => !SOURCE_PROMOTION_PATTERN.test(block))
    .join("\n\n");
  const withoutUnauthorizedLinks = withoutPromotion.replace(URL_PATTERN, (value) => {
    const clean = value.replace(/[),.!?;:]+$/g, "");
    return purchaseLink && clean === purchaseLink ? value : "";
  });
  return withoutUnauthorizedLinks
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalizeNumber(value: string) {
  return value.replace(/[.,]/g, "");
}

/**
 * Turns what the AI extracted into facts the template can trust: every price
 * and number must already exist in the source message, so the AI can't
 * change a price or invent a discount; anything unverifiable is dropped.
 */
export function verifyExtractedOffer(original: string, extracted: ExtractedOffer): OfferCopyFacts {
  const productName = extracted.product_name.replace(URL_PATTERN, "").replace(/\s+/g, " ").trim();
  if (productName.length < 3 || productName.length > 160) throw new Error("A IA não identificou o nome do produto.");

  const sourceAmounts = new Set(brlAmountsInCents(original));
  const verifiedPrice = (value: string | null) => {
    const cents = parseBrlPrice(value);
    if (cents === null) return null;
    if (!sourceAmounts.has(cents)) throw new Error("A IA retornou um preço que não está na oferta original.");
    return cents;
  };
  const priceToCents = verifiedPrice(extracted.price_to);
  const priceFromCents = priceToCents === null ? null : verifiedPrice(extracted.price_from);

  const inOriginal = (value: string) => original.toLowerCase().includes(value.toLowerCase());
  const coupon = extracted.coupon?.trim() || null;
  const verifiedCoupon = coupon && COUPON_CODE.test(coupon) && inOriginal(coupon) ? coupon : null;
  const condition = extracted.price_condition?.replace(/\s+/g, " ").trim() || null;
  const priceCondition = priceToCents !== null && condition && condition.length <= 30 && !/\d/.test(condition) && inOriginal(condition) ? condition : null;

  const sourceNumbers = new Set((original.match(NUMBER_FACT) || []).map(normalizeNumber));
  const extraLines = extracted.extra_lines
    .map((line) => line.replace(/\s+/g, " ").trim().replace(BARE_BRL_AMOUNT, "R$ $1"))
    .filter((line) => line.length >= 3 && line.length <= 120 && !HAS_URL.test(line))
    .filter((line) => (line.match(NUMBER_FACT) || []).every((fact) => sourceNumbers.has(normalizeNumber(fact))))
    .slice(0, MAX_EXTRA_LINES);

  const stated = extracted.discount_percent;
  const statedIsWritten = stated !== null && Number.isInteger(stated) && new RegExp(`(^|\\D)${stated}\\s*%`).test(original);
  const statedDiscountPercent = statedIsWritten ? stated : null;

  return { productName, priceFromCents, priceToCents, priceCondition, statedDiscountPercent, coupon: verifiedCoupon, extraLines };
}

export class OfferAiRewriter {
  private client: ResponsesClient;
  constructor(
    apiKey = process.env.OPENAI_API_KEY,
    // Modelo dedicado ao rewrite de ofertas — independente do OPENAI_MODEL global.
    // Troque via OPENAI_REWRITE_MODEL no Railway sem afetar outros fluxos de IA.
    private model = process.env.OPENAI_REWRITE_MODEL || "gpt-4o-mini",
    client?: ResponsesClient,
    private random: () => number = Math.random
  ) {
    if (!apiKey && !client) throw new Error("OPENAI_API_KEY não configurada.");
    this.client = client || new OpenAI({ apiKey });
  }

  async rewrite(input: RewriteInput): Promise<RewriteResult> {
    const purchaseLink = input.purchaseLink || null;
    if (!purchaseLink) throw new Error("Oferta sem link de compra autorizado para montar a copy.");
    const sanitizedText = sanitizeSourcePromotion(input.text, purchaseLink);
    const response = await this.client.responses.create({
      model: this.model,
      max_output_tokens: 400,
      input: [
        {
          role: "system",
          content: [
            "Você extrai os dados de uma oferta de grupo de WhatsApp brasileiro. Não escreva copy; só preencha os campos.",
            "product_name: nome do produto como aparece na oferta, com marca, modelo, tamanho e quantidade; sem emojis, preço, link, chamadas ('corre', 'oferta') ou nome da loja do grupo.",
            "price_to: o preço atual a pagar (o 'Por', 'Agora', 'Só', o preço em destaque), exatamente como escrito. null se não houver preço.",
            "price_from: o preço antigo ('De', riscado, 'Antes'), exatamente como escrito. null se não houver.",
            "price_condition: a condição de pagamento ligada ao preço atual, curta e exatamente como escrita (ex.: 'no Pix', 'via Pix', 'à vista'), ou null.",
            "discount_percent: o percentual de desconto escrito na oferta (ex.: '50% off' -> 50), como número inteiro, ou null. Não calcule.",
            "coupon: só um código de cupom de verdade (ex.: FRALDA10), exatamente como escrito, ou null. Instruções como 'resgate o cupom de R$20 OFF' não são código: vão em extra_lines.",
            "extra_lines: condições reais de compra que estão na oferta além do preço principal (preço por unidade, compra em quantidade, recorrência/Programe e Poupe, parcelamento, frete grátis, cashback, cupom para resgatar), uma por item, curtas e fiéis ao texto; sem emojis e sem links; escreva valores em reais com 'R$' na frente. Não inclua avisos ('promoção pode acabar', 'sujeito a alteração'), chamadas de urgência, o preço principal nem o nome do produto. Lista vazia se não houver.",
            "Nunca invente nem calcule nada: todo número que você devolver precisa estar escrito na oferta original.",
            "Ignore divulgação do grupo fonte, pedidos para seguir perfis e links."
          ].join("\n")
        },
        { role: "user", content: sanitizedText }
      ],
      text: {
        format: {
          type: "json_schema",
          name: "offer_facts",
          strict: true,
          schema: {
            type: "object",
            properties: {
              product_name: { type: "string" },
              price_from: { type: ["string", "null"] },
              price_to: { type: ["string", "null"] },
              price_condition: { type: ["string", "null"] },
              discount_percent: { type: ["integer", "null"] },
              coupon: { type: ["string", "null"] },
              extra_lines: { type: "array", items: { type: "string" } }
            },
            required: ["product_name", "price_from", "price_to", "price_condition", "discount_percent", "coupon", "extra_lines"],
            additionalProperties: false
          }
        }
      }
    });
    if (response.status !== "completed" || !response.output_text) throw new Error("A OpenAI não retornou os dados da oferta.");
    const extracted = ExtractedOffer.parse(JSON.parse(response.output_text));
    const facts = verifyExtractedOffer(sanitizedText, extracted);
    const result = buildOfferCopy(facts, purchaseLink, this.random);

    // Observabilidade: custo do rewrite por oferta
    const usage = (response as any).usage;
    console.info({
      event: "offer_rewrite_completed",
      feature: "offer_rewrite",
      model: this.model,
      input_tokens: usage?.input_tokens ?? null,
      output_tokens: usage?.output_tokens ?? null,
      total_tokens: usage?.total_tokens ?? null,
      has_discount: Boolean(facts.priceFromCents),
      extra_lines: facts.extraLines.length
    });

    return { text: result, model: this.model };
  }
}
