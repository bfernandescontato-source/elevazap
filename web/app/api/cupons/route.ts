import { NextResponse } from "next/server";
import { requireAccountContext } from "@/lib/security";
import { isExtensaoVitrineEnabled } from "@/modules/affiliate-catalog/server/catalog-agenda-service";
import { listShopeeOffers } from "@/modules/affiliate-catalog/server/shopee-offers-service";

export async function GET() {
  const context = await requireAccountContext(); if (context.error) return context.error;
  if (!await isExtensaoVitrineEnabled(context.accountId)) return NextResponse.json({ error: "Área ainda não liberada para sua conta." }, { status: 403 });
  try { return NextResponse.json({ offers: await listShopeeOffers(context.database, context.accountId) }, { headers: { "cache-control": "no-store" } }); }
  catch (error) {
    const code = error instanceof Error ? error.message : "SHOPEE";
    return NextResponse.json({ error: code === "SHOPEE_NOT_CONNECTED" ? "Conecte sua conta Shopee Affiliate em Integrações para ver as ofertas." : "Não foi possível carregar as ofertas da Shopee agora.", code }, { status: code === "SHOPEE_NOT_CONNECTED" ? 409 : 503 });
  }
}
