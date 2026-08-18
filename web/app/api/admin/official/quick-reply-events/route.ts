import { NextResponse } from "next/server";
import { requireInternalAdmin } from "@/lib/internal-admin";
import { listRecentMetaEvents } from "@/modules/official-whatsapp/server/hubla-events";

export async function GET() {
  const guard = await requireInternalAdmin();
  if (guard.error) return guard.error;
  const events = await listRecentMetaEvents(30);
  return NextResponse.json({ events });
}
