import { NextResponse } from "next/server";
import { requireInternalAdmin } from "@/lib/internal-admin";
import { appUrl } from "@/lib/env";

export async function GET() {
  const guard = await requireInternalAdmin();
  if (guard.error) return guard.error;
  return NextResponse.json({
    configured: true,
    url: `${appUrl()}/api/webhooks/elevapay`,
    headerName: "x-elevapay-token",
    event: "order.paid"
  });
}
