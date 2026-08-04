import { NextRequest, NextResponse } from "next/server";
import { guardAdminMutation } from "@/lib/security";
import { callWhatsappService } from "@/lib/whatsapp-service";

export async function POST(request: NextRequest) {
  const guard = await guardAdminMutation(request, "admin_action_ip");
  if (guard) return guard;
  try {
    return NextResponse.json(await callWhatsappService("/refresh-groups", { method: "POST" }));
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "Não foi possível atualizar os grupos." }, { status: 503 });
  }
}
