import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/security";
import { callWhatsappService } from "@/lib/whatsapp-service";

export async function GET() {
  const guard = await requireAdmin();
  if (guard) return guard;
  try { return NextResponse.json(await callWhatsappService("/qr")); }
  catch { return NextResponse.json({ qr: "" }); }
}
