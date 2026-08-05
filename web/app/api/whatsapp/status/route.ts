import { NextResponse } from "next/server";
import { callWhatsappService } from "@/lib/whatsapp-service";
import { requireTenantSender } from "@/lib/tenant-whatsapp";

export async function GET() {
  const tenant = await requireTenantSender();
  if (tenant.error) return tenant.error;
  if (!tenant.sender) return NextResponse.json({ status: "disconnected", queue: { size: 0 } });
  try { return NextResponse.json(await callWhatsappService(`/senders/${tenant.sender.session_name}/status`)); }
  catch { return NextResponse.json({ status: "disconnected", queue: { size: 0, highPriority: 0, normalPriority: 0 }, lock: "unknown", ffmpeg: "unknown" }); }
}
