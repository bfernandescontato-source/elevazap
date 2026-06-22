import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/security";
import { callWhatsappService } from "@/lib/whatsapp-service";

export async function GET() {
  const guard = await requireAdmin();
  if (guard) return guard;
  try { return NextResponse.json(await callWhatsappService("/status")); }
  catch { return NextResponse.json({ status: "disconnected", queue: { size: 0, highPriority: 0, normalPriority: 0 }, lock: "unknown", ffmpeg: "unknown" }); }
}
