import OpenAI from "openai";
import { z } from "zod";

const RewriteOutput = z.object({ rewritten_text: z.string() });
const URL_PATTERN = /https?:\/\/[^\s<>"']+/gi;
const PRICE_PATTERN = /(?:R\$\s*)?\d{1,3}(?:\.\d{3})*(?:,\d{2})|\d+(?:[.,]\d+)?%/gi;

export type RewriteInput = {
  text: string;
  purchaseLink?: string | null;
  links: string[];
};

export type RewriteResult = { text: string; model: string };

type ResponsesClient = Pick<OpenAI, "responses">;

function normalizedFacts(text: string) {
  return (text.match(PRICE_PATTERN) || []).map((value) => value.toLowerCase().replace(/\s+/g, "")).sort();
}

function urls(text: string) {
  return (text.match(URL_PATTERN) || []).map((value) => value.replace(/[),.!?;:]+$/g, ""));
}

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

export function validateRewrite(original: string, rewritten: string, purchaseLink?: string | null) {
  const output = rewritten.trim();
  if (output.length < 15 || output.length > 4_000) throw new Error("A copy gerada possui tamanho inválido.");
  const outputUrls = urls(output);
  if (purchaseLink) {
    if (outputUrls.filter((value) => value === purchaseLink).length !== 1) throw new Error("A copy gerada não preservou o link de compra.");
    if (outputUrls.some((value) => value !== purchaseLink)) throw new Error("A copy gerada incluiu um link não permitido.");
  } else if (outputUrls.length) {
    throw new Error("A copy gerada incluiu um link não permitido.");
  }
  const expectedFacts = normalizedFacts(original);
  const actualFacts = normalizedFacts(output);
  if (expectedFacts.some((fact) => !actualFacts.includes(fact))) throw new Error("A copy gerada alterou preço, desconto ou percentual.");
  return output;
}

export class OfferAiRewriter {
  private client: ResponsesClient;
  constructor(
    apiKey = process.env.OPENAI_API_KEY,
    // Modelo dedicado ao rewrite de ofertas — independente do OPENAI_MODEL global.
    // Troque via OPENAI_REWRITE_MODEL no Railway sem afetar outros fluxos de IA.
    private model = process.env.OPENAI_REWRITE_MODEL || "gpt-4o-mini",
    client?: ResponsesClient
  ) {
    if (!apiKey && !client) throw new Error("OPENAI_API_KEY não configurada.");
    this.client = client || new OpenAI({ apiKey });
  }

  async rewrite(input: RewriteInput): Promise<RewriteResult> {
    const purchaseLink = input.purchaseLink || null;
    const sanitizedText = sanitizeSourcePromotion(input.text, purchaseLink);
    const response = await this.client.responses.create({
      model: this.model,
      max_output_tokens: 250,
      input: [
        {
          role: "system",
          content: [
            "Você é um copywriter brasileiro especializado em ofertas para grupos de WhatsApp.",
            "Reescreva de forma clara, curta, persuasiva e natural, com boa leitura no celular.",
            "Preserve rigorosamente produto, marca, quantidade, preço, desconto, condições e demais fatos presentes.",
            "Nunca invente benefícios, urgência, estoque, frete, cupom, preço anterior ou avaliação.",
            "Remova divulgação do grupo fonte, nomes de perfis, pedidos para seguir redes sociais e links que não sejam o link de compra autorizado.",
            "Use o link de compra autorizado exatamente uma vez, sem modificar nenhum caractere.",
            "Não use markdown de título; pode usar negrito do WhatsApp com asteriscos e poucos emojis."
          ].join(" ")
        },
        {
          role: "user",
          content: JSON.stringify({
            original_message: sanitizedText,
            authorized_purchase_link: purchaseLink,
            detected_links: input.links
          })
        }
      ],
      text: {
        format: {
          type: "json_schema",
          name: "offer_rewrite",
          strict: true,
          schema: {
            type: "object",
            properties: { rewritten_text: { type: "string" } },
            required: ["rewritten_text"],
            additionalProperties: false
          }
        }
      }
    });
    if (response.status !== "completed" || !response.output_text) throw new Error("A OpenAI não retornou uma copy válida.");
    const parsed = RewriteOutput.parse(JSON.parse(response.output_text));
    const result = validateRewrite(sanitizedText, parsed.rewritten_text, purchaseLink);

    // Observabilidade: custo do rewrite por oferta
    const usage = (response as any).usage;
    console.info({
      event: "offer_rewrite_completed",
      feature: "offer_rewrite",
      model: this.model,
      input_tokens: usage?.input_tokens ?? null,
      output_tokens: usage?.output_tokens ?? null,
      total_tokens: usage?.total_tokens ?? null,
    });

    return { text: result, model: this.model };
  }
}
