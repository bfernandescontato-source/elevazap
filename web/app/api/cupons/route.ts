import { NextResponse } from "next/server";
import { requireAccountContext } from "@/lib/security";
import { isExtensaoVitrineEnabled } from "@/modules/affiliate-catalog/server/catalog-agenda-service";
import { listShopeeCoupons } from "@/modules/affiliate-catalog/server/shopee-coupons-service";

export async function GET() {
  const context = await requireAccountContext(); if (context.error) return context.error;
  if (!await isExtensaoVitrineEnabled(context.accountId)) return NextResponse.json({ error: "Área ainda não liberada para sua conta." }, { status: 403 });
  try { return NextResponse.json({ coupons: await listShopeeCoupons() }, { headers: { "cache-control": "no-store" } }); }
  catch { return NextResponse.json({ error: "Não foi possível carregar os cupons agora." }, { status: 500 }); }
}
