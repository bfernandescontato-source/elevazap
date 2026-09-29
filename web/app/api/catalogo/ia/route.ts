import { NextRequest, NextResponse } from "next/server";
import { guardAdminMutation, requireAccountContext } from "@/lib/security";
import { aiMessageSchema, isConfirmedAffiliateUrl } from "@/modules/affiliate-catalog/schemas";
import { buildCatalogOfferMessage } from "@/modules/affiliate-catalog/offer-message";
import type { AffiliateOffer } from "@/modules/affiliate-catalog/types";

// A mensagem do Catálogo sai sempre no modelo fixo do Disparei — o mesmo do
// agendamento em massa e do Piloto — sem chamar IA (decisão de 29/09/2026: não
// gastar crédito). "Gerar outra" sorteia outro gancho aprovado.
export async function POST(request: NextRequest) {
  const guard = await guardAdminMutation(request, "catalog_ai_ip"); if (guard) return guard;
  const context = await requireAccountContext(); if (context.error) return context.error;
  const parsed = aiMessageSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Dados da oferta inválidos." }, { status: 400 });
  const { offer } = parsed.data;
  if (!isConfirmedAffiliateUrl(offer.provider, offer.affiliateUrl)) return NextResponse.json({ error: "Gere e confirme o link afiliado antes de criar a mensagem." }, { status: 400 });
  return NextResponse.json({ message: buildCatalogOfferMessage(offer as AffiliateOffer, offer.affiliateUrl!) });
}
