import { NextRequest, NextResponse } from "next/server";
import { guardAdminMutation } from "@/lib/security";
import { callWhatsappService } from "@/lib/whatsapp-service";
import { requireTenantSender } from "@/lib/tenant-whatsapp";

export async function POST(request: NextRequest) {
  const guard = await guardAdminMutation(request, "admin_action_ip");
  if (guard) return guard;
  const tenant = await requireTenantSender();
  if (tenant.error) return tenant.error;
  if (!tenant.sender) return NextResponse.json({ error: "Cadastre um número WhatsApp antes de atualizar grupos." }, { status: 404 });
  try {
    return NextResponse.json(await callWhatsappService(`/senders/${tenant.sender.session_name}/refresh-groups`, { method: "POST" }));
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "Não foi possível atualizar os grupos." }, { status: 503 });
  }
}
