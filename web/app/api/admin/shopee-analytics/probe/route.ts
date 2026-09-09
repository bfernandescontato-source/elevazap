import { NextResponse } from "next/server";
import { requireAccountContext } from "@/lib/security";
import { probeShopeeAnalyticsSchema } from "@/modules/shopee-analytics/server/probe";

export const dynamic = "force-dynamic";

export async function GET() {
  const context = await requireAccountContext();
  if (context.error) return context.error;
  if (context.session.role !== "admin") return NextResponse.json({ error: "Apenas administradores podem validar a integração." }, { status: 403 });
  try {
    return NextResponse.json(await probeShopeeAnalyticsSchema(context.database, context.accountId));
  } catch (error) {
    const code = error instanceof Error ? error.message : "SHOPEE_UNAVAILABLE";
    console.error({ event: "shopee_analytics_probe_failed", component: "shopee-analytics", account_id: context.accountId, code });
    return NextResponse.json({ error: code }, { status: code === "SHOPEE_NOT_CONNECTED" ? 409 : 502 });
  }
}
