import { NextRequest, NextResponse } from "next/server";
import { guardAdminMutation, requireAccountContext } from "@/lib/security";
import { env } from "@/lib/env";
import { aiMessageSchema, isConfirmedAffiliateUrl } from "@/modules/affiliate-catalog/schemas";

function openAiFailure(response: Response) {
  if (response.status === 401) return "A chave da IA configurada no servidor é inválida ou expirou.";
  if (response.status === 429) return "A IA atingiu o limite de uso. Aguarde um instante e tente novamente.";
  if (response.status === 404) return "O modelo de IA configurado não está disponível para esta chave.";
  return "Não foi possível criar sua oferta agora. Tente novamente em alguns instantes.";
}

export async function POST(request: NextRequest) {
  const guard = await guardAdminMutation(request, "catalog_ai_ip"); if (guard) return guard;
  const context = await requireAccountContext(); if (context.error) return context.error;
  const parsed = aiMessageSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Dados da oferta inválidos." }, { status: 400 });
  const apiKey = env().OPENAI_API_KEY;
  if (!apiKey) {
    console.error({ event: "catalog_ai_not_configured", component: "affiliate-catalog" });
    return NextResponse.json({ error: "A geração com IA ainda não foi configurada no servidor. Avise o administrador para adicionar a chave da IA." }, { status: 503 });
  }
  const { offer, style, length, instruction, currentMessage } = parsed.data;
  if (!isConfirmedAffiliateUrl(offer.provider, offer.affiliateUrl)) return NextResponse.json({ error: "Gere e confirme o link afiliado antes de criar a mensagem." }, { status: 400 });
  const affiliateUrl = offer.affiliateUrl!;
  const facts = { marketplace: offer.provider === "MERCADO_LIVRE" ? "Mercado Livre" : "Shopee", productName: offer.name, price: offer.priceMin, originalPrice: offer.originalPrice, discountPercentage: offer.discountPercentage, sales: offer.sales, rating: offer.rating, shopName: offer.shopName, categoryIds: offer.categoryIds, affiliateUrl };
  const model = env().OPENAI_MODEL;
  const requestBody: Record<string, unknown> = {
    model, max_output_tokens: 700,
    input: [{ role: "system", content: "Você escreve ofertas brasileiras para grupos de WhatsApp. Use somente os fatos JSON fornecidos. Nunca invente estoque, urgência, frete, cupom, cashback, prazo, benefício ou característica. Omita dados ausentes. Não mencione comissão. Escreva com leitura fácil, poucos emojis, espaçamento e CTA. Inclua o affiliateUrl exatamente uma vez e sem alteração. Retorne apenas a mensagem final. Se a instrução for headline, altere somente a primeira frase da mensagem atual." }, { role: "user", content: JSON.stringify({ facts, style, length, instruction, currentMessage }) }]
  };
  // Modelos sem raciocínio (como gpt-4o-mini) rejeitam o campo `reasoning`.
  if (/^(gpt-5|o[1-9])/.test(model)) requestBody.reasoning = { effort: "low" };
  let response: Response;
  try {
    response = await fetch("https://api.openai.com/v1/responses", { method: "POST", headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" }, body: JSON.stringify(requestBody), signal: AbortSignal.timeout(25_000) });
  } catch (error) {
    console.error({ event: "catalog_ai_request_failed", component: "affiliate-catalog", error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ error: "A IA demorou para responder. Tente novamente em alguns instantes." }, { status: 504 });
  }
  if (!response.ok) {
    console.error({ event: "catalog_ai_response_failed", component: "affiliate-catalog", status: response.status, model });
    return NextResponse.json({ error: openAiFailure(response) }, { status: response.status === 429 ? 429 : 503 });
  }
  const data = await response.json();
  const message = String(data.output_text || data.output?.flatMap((o: any) => o.content || []).find((c: any) => c.type === "output_text")?.text || "").trim();
  if (!message || !message.includes(affiliateUrl)) return NextResponse.json({ error: "A IA não retornou uma mensagem segura. Tente novamente." }, { status: 422 });
  return NextResponse.json({ message });
}
