import { NextRequest, NextResponse } from "next/server";
import { guardAdminMutation, requireAccountContext } from "@/lib/security";
import { affiliateLinkSchema } from "@/modules/affiliate-catalog/schemas";
import { startMercadoLivreAffiliateLink } from "@/modules/affiliate-catalog/server/mercado-livre-link-service";
import { amazonAffiliateLink, magaluAffiliateLink, shopeeAffiliateLink, StoreLinkError } from "@/modules/affiliate-catalog/server/store-link-service";

export async function POST(request: NextRequest) {
  const guard = await guardAdminMutation(request, "catalog_affiliate_link_ip"); if (guard) return guard;
  const context = await requireAccountContext(); if (context.error) return context.error;
  const parsed = affiliateLinkSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Produto inválido." }, { status: 400 });
  const offer = parsed.data.offer;
  // Amazon, Magalu e Shopee sem link vêm do carrinho da extensão (Vitrine).
  if (offer.provider !== "MERCADO_LIVRE" && !(offer.provider === "SHOPEE" && offer.affiliateUrl)) {
    if (!offer.productUrl) return NextResponse.json({ error: "A loja não forneceu o endereço deste produto." }, { status: 422 });
    try {
      const affiliateUrl = offer.provider === "AMAZON" ? await amazonAffiliateLink(context.database, context.accountId, offer.productUrl)
        : offer.provider === "MAGALU" ? magaluAffiliateLink(offer.productUrl)
        : await shopeeAffiliateLink(context.database, context.accountId, offer.productUrl);
      return NextResponse.json({ status: "completed", affiliateUrl });
    } catch (error) {
      if (error instanceof StoreLinkError) return NextResponse.json({ error: error.message }, { status: error.status });
      console.error({ event: "catalog_store_link_failed", component: "affiliate-catalog", account_id: context.accountId, provider: offer.provider, error: error instanceof Error ? error.message : String(error) });
      return NextResponse.json({ error: "Não foi possível gerar o link afiliado." }, { status: 503 });
    }
  }
  if (offer.provider === "SHOPEE") return NextResponse.json({ status: "completed", affiliateUrl: offer.affiliateUrl });
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
