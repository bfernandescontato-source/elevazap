import { NextResponse } from "next/server";
import { callWhatsappService } from "@/lib/whatsapp-service";
import { requireTenantSender } from "@/lib/tenant-whatsapp";

export async function GET() {
  const tenant = await requireTenantSender();
  if (tenant.error) return tenant.error;
  if (!tenant.sender) return NextResponse.json({ qr: "", status: "disconnected" });
  try { return NextResponse.json(await callWhatsappService(`/senders/${tenant.sender.session_name}/status`)); }
  catch { return NextResponse.json({ qr: "" }); }
}
