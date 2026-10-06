import { NextResponse } from "next/server";
import { requireAccountContext } from "@/lib/security";
import { isExtensaoVitrineEnabled } from "@/modules/affiliate-catalog/server/catalog-agenda-service";
import { listShopeeOffers } from "@/modules/affiliate-catalog/server/shopee-offers-service";
import { listShopeeCoupons } from "@/modules/affiliate-catalog/server/shopee-coupons-service";

export async function GET() {
  const context = await requireAccountContext(); if (context.error) return context.error;
  if (!await isExtensaoVitrineEnabled(context.accountId)) return NextResponse.json({ error: "Área ainda não liberada para sua conta." }, { status: 403 });
  const coupons = await listShopeeCoupons().catch(() => []);
  let offers: any[] = []; let offersError: string | null = null;
  try { offers = await listShopeeOffers(context.database, context.accountId); }
  catch (e) { offersError = e instanceof Error && e.message === "SHOPEE_NOT_CONNECTED" ? "Conecte sua conta Shopee Affiliate em Integrações para ver as ofertas." : "Ofertas da Shopee indisponíveis agora."; }
  return NextResponse.json({ coupons, offers, offersError }, { headers: { "cache-control": "no-store" } });
}
