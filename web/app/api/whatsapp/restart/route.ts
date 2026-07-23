import { NextRequest, NextResponse } from "next/server";
import { guardAdminMutation } from "@/lib/security";
import { callWhatsappService } from "@/lib/whatsapp-service";

export async function POST(request: NextRequest) {
  const guard = await guardAdminMutation(request, "admin_action_ip");
  if (guard) return guard;
  try {
    return NextResponse.json(await callWhatsappService("/restart", { method: "POST" }));
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "Não foi possível gerar um novo QR Code." }, { status: 503 });
  }
}
