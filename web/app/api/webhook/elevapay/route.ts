import { NextResponse } from "next/server";

// Removed from the active integration because one global secret cannot resolve
// a tenant. Account-specific webhooks live at /api/webhooks/elevazap/[token].
export async function POST() {
  return NextResponse.json({ error: "Webhook legado desativado. Use o webhook exclusivo da conta." }, { status: 410 });
}
