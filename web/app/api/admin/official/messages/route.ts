import { NextResponse } from "next/server";
import { requireInternalAdmin } from "@/lib/internal-admin";
import { listRecentMessages } from "@/modules/official-whatsapp/server/messages-store";

export async function GET() {
  const guard = await requireInternalAdmin();
  if (guard.error) return guard.error;
  const messages = await listRecentMessages(30);
  return NextResponse.json({ messages });
}
