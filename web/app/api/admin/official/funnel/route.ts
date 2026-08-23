import { NextRequest, NextResponse } from "next/server";
import { requireInternalAdmin } from "@/lib/internal-admin";
import { getOfficialFunnelSummary } from "@/modules/official-whatsapp/server/funnel";

export async function GET(request: NextRequest) {
  const guard = await requireInternalAdmin();
  if (guard.error) return guard.error;
  const hours = Number(request.nextUrl.searchParams.get("hours") || 24);
  return NextResponse.json({ funnel: await getOfficialFunnelSummary(hours) });
}
