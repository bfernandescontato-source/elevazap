import { NextRequest, NextResponse } from "next/server";
import { guardInternalAdminMutation, requireInternalAdmin } from "@/lib/internal-admin";
import { createAutomation, listAutomations } from "@/modules/official-whatsapp/server/automations";

export async function GET() {
  const guard = await requireInternalAdmin();
  if (guard.error) return guard.error;
  const automations = await listAutomations();
  return NextResponse.json({ automations });
}

export async function POST(request: NextRequest) {
  const guard = await guardInternalAdminMutation(request, "official_automation_write_ip");
  if (guard) return guard;

  const body = await request.json().catch(() => null) as Record<string, any> | null;
  const eventType = String(body?.eventType || "").trim();
  const templateName = String(body?.templateName || "").trim();
  const templateLanguage = String(body?.templateLanguage || "").trim();
  if (!eventType || !templateName || !templateLanguage) {
    return NextResponse.json({ error: "Evento, template e idioma são obrigatórios." }, { status: 400 });
  }
  const productId = String(body?.productId || "").trim() || null;
  const productName = String(body?.productName || "").trim() || null;
  const variableMapping = body?.variableMapping && typeof body.variableMapping === "object" ? body.variableMapping : {};
  const active = body?.active !== false;

  try {
    const automation = await createAutomation({ eventType, productId, productName, templateName, templateLanguage, variableMapping, active });
    return NextResponse.json({ ok: true, automation });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Falha ao criar automação." }, { status: 500 });
  }
}
