import { NextRequest, NextResponse } from "next/server";
import { guardAdminMutation, requireAccountContext } from "@/lib/security";
import { affiliateLinkSchema } from "@/modules/affiliate-catalog/schemas";
import { startMercadoLivreAffiliateLink } from "@/modules/affiliate-catalog/server/mercado-livre-link-service";

export async function POST(request: NextRequest) {
  const guard = await guardAdminMutation(request, "catalog_affiliate_link_ip"); if (guard) return guard;
  const context = await requireAccountContext(); if (context.error) return context.error;
  const parsed = affiliateLinkSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Produto inválido." }, { status: 400 });
  const offer = parsed.data.offer;
  if (offer.provider === "SHOPEE") {
    if (!offer.affiliateUrl) return NextResponse.json({ error: "A Shopee não forneceu o link afiliado desta oferta." }, { status: 422 });
    return NextResponse.json({ status: "completed", affiliateUrl: offer.affiliateUrl });
  }
  if (!offer.productUrl) return NextResponse.json({ error: "O Mercado Livre não forneceu o endereço deste produto." }, { status: 422 });
  try {
    return NextResponse.json(await startMercadoLivreAffiliateLink(context.database, context.accountId, offer.productUrl, offer.externalItemId));
  } catch (error) {
    const code = error instanceof Error ? error.message : "MERCADO_LIVRE_LINK_ERROR";
    const message = code === "MERCADO_LIVRE_EXTENSION_NOT_CONNECTED"
      ? "Conecte a extensão do Mercado Livre no Piloto Automático para gerar seu link afiliado."
      : "Não foi possível iniciar a geração do link afiliado.";
    return NextResponse.json({ error: message, code }, { status: code === "MERCADO_LIVRE_EXTENSION_NOT_CONNECTED" ? 409 : 503 });
  }
}
