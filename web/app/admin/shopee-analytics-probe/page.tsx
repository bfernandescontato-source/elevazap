import { redirect } from "next/navigation";
import { requireAccountContext } from "@/lib/security";
import { probeShopeeAnalyticsSchema, probeShopeeConversions } from "@/modules/shopee-analytics/server/probe";

export const dynamic = "force-dynamic";

export default async function ShopeeAnalyticsProbePage() {
  const context = await requireAccountContext();
  if (context.error || context.session.role !== "admin") redirect("/login");
  try {
    const [schema, conversions] = await Promise.all([
      probeShopeeAnalyticsSchema(context.database, context.accountId),
      probeShopeeConversions(context.database, context.accountId)
    ]);
    const result = { schema, conversions };
    return <main className="p-6"><h1 className="mb-4 text-xl font-semibold">Shopee Analytics — validação técnica</h1><pre className="whitespace-pre-wrap break-words text-xs">{JSON.stringify(result, null, 2)}</pre></main>;
  } catch (error) {
    const code = error instanceof Error ? error.message : "SHOPEE_UNAVAILABLE";
    return <main className="p-6"><h1 className="mb-4 text-xl font-semibold">Shopee Analytics — validação técnica</h1><p>{code}</p></main>;
  }
}
