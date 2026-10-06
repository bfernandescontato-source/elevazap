import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAccountContext } from "@/lib/security";
import { supabaseAdmin } from "@/lib/supabase";
import { isExtensaoVitrineEnabled } from "@/modules/affiliate-catalog/server/catalog-agenda-service";
import { shopeeAffiliateLink, StoreLinkError } from "@/modules/affiliate-catalog/server/store-link-service";
import { mensagemCupom } from "@/modules/affiliate-catalog/coupon-message";

const schema = z.object({ promotionId: z.string().min(1).max(64) });

export async function POST(request: NextRequest) {
  const context = await requireAccountContext(); if (context.error) return context.error;
  if (!await isExtensaoVitrineEnabled(context.accountId)) return NextResponse.json({ error: "Área de cupons não liberada." }, { status: 403 });
  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Dados inválidos." }, { status: 400 });
  const { data: cupom } = await supabaseAdmin().from("shopee_coupons").select("*").eq("promotion_id", parsed.data.promotionId).eq("active", true).maybeSingle();
  if (!cupom) return NextResponse.json({ error: "Cupom não está mais disponível." }, { status: 404 });
  try {
    const destino = cupom.redirect_url && /shopee\.com\.br/i.test(cupom.redirect_url) ? cupom.redirect_url : "https://shopee.com.br/m/cupom-de-desconto";
    const affiliateUrl = await shopeeAffiliateLink(context.database, context.accountId, destino);
    return NextResponse.json({ message: mensagemCupom(cupom, affiliateUrl), affiliateUrl });
  } catch (error) {
    if (error instanceof StoreLinkError) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: "Não foi possível preparar a mensagem do cupom." }, { status: 500 });
  }
}
