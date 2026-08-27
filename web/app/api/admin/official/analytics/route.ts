import { NextRequest, NextResponse } from "next/server";
import { requireInternalAdmin } from "@/lib/internal-admin";
import { getOfficialAnalytics } from "@/modules/official-whatsapp/server/analytics";

export async function GET(request: NextRequest) {
  const guard = await requireInternalAdmin(); if (guard.error) return guard.error;
  const q = request.nextUrl.searchParams; const end = q.get("end") || new Date().toISOString();
  const start = q.get("start") || new Date(Date.now() - 30 * 86400000).toISOString();
  const type = q.get("type");
  try { return NextResponse.json({ analytics: await getOfficialAnalytics({ start, end, type: type === "automation" || type === "broadcast" ? type : "all", flowId: q.get("flowId") || undefined, broadcastId: q.get("broadcastId") || undefined }) }); }
  catch (error) { console.error("[official-analytics]", error); return NextResponse.json({ error: "Não foi possível carregar as métricas." }, { status: 500 }); }
}
