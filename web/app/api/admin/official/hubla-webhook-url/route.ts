import { NextResponse } from "next/server";
import { requireInternalAdmin } from "@/lib/internal-admin";
import { appUrl, env } from "@/lib/env";

export async function GET() {
  const guard = await requireInternalAdmin();
  if (guard.error) return guard.error;
  const secret = env().HUBLA_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ configured: false, url: null });
  return NextResponse.json({ configured: true, url: `${appUrl()}/api/webhooks/hubla/${secret}` });
}
