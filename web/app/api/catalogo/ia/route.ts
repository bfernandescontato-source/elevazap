import { NextRequest, NextResponse } from "next/server";
import { guardAdminMutation, requireAccountContext } from "@/lib/security";
import { env } from "@/lib/env";
import { aiMessageSchema } from "@/modules/affiliate-catalog/schemas";

export async function POST(request: NextRequest) {
  const guard = await guardAdminMutation(request, "catalog_ai_ip"); if (guard) return guard;
  const context = await requireAccountContext(); if (context.error) return context.error;
  const parsed = aiMessageSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Dados da oferta inválidos." }, { status: 400 });
  const apiKey = env().OPENAI_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "A geração com IA ainda não foi configurada." }, { status: 503 });
  const { offer, style, length, instruction, currentMessage } = parsed.data;
  if (!offer.affiliateUrl) return NextResponse.json({ error: "Esta oferta não possui link de afiliado." }, { status: 400 });
  const facts = { productName: offer.name, price: offer.priceMin, originalPrice: offer.originalPrice, discountPercentage: offer.discountPercentage, sales: offer.sales, rating: offer.rating, shopName: offer.shopName, categoryIds: offer.categoryIds, affiliateUrl: offer.affiliateUrl };
  const response = await fetch("https://api.openai.com/v1/responses", { method: "POST", headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" }, body: JSON.stringify({
    model: env().OPENAI_MODEL, reasoning: { effort: "low" }, max_output_tokens: 700,
    input: [{ role: "system", content: "Você escreve ofertas brasileiras para grupos de WhatsApp. Use somente os fatos JSON fornecidos. Nunca invente estoque, urgência, frete, cupom, cashback, prazo, benefício ou característica. Omita dados ausentes. Não mencione comissão. Escreva com leitura fácil, poucos emojis, espaçamento e CTA. Inclua o affiliateUrl exatamente uma vez e sem alteração. Retorne apenas a mensagem final. Se a instrução for headline, altere somente a primeira frase da mensagem atual." }, { role: "user", content: JSON.stringify({ facts, style, length, instruction, currentMessage }) }]
  }), signal: AbortSignal.timeout(25_000) }).catch(() => null);
  if (!response?.ok) return NextResponse.json({ error: "Não foi possível criar sua oferta agora." }, { status: 503 });
  const data = await response.json();
  const message = String(data.output_text || data.output?.flatMap((o: any) => o.content || []).find((c: any) => c.type === "output_text")?.text || "").trim();
  if (!message || !message.includes(offer.affiliateUrl)) return NextResponse.json({ error: "A IA não retornou uma mensagem segura. Tente novamente." }, { status: 422 });
  return NextResponse.json({ message });
}
