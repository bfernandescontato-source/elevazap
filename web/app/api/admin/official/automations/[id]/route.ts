import { NextRequest, NextResponse } from "next/server";
import { guardInternalAdminMutation } from "@/lib/internal-admin";
import { updateAutomation } from "@/modules/official-whatsapp/server/automations";
import { connectionIdSchema } from "@/modules/official-whatsapp/server/official-connections";
import { findTemplate } from "@/modules/official-whatsapp/server/templates";

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const guard = await guardInternalAdminMutation(request, "official_automation_write_ip");
  if (guard) return guard;

  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "Dados da automação não informados." }, { status: 400 });

  const changes: Parameters<typeof updateAutomation>[1] = {};
  if (typeof body.active === "boolean") changes.active = body.active;

  const isEditing = body.eventType !== undefined || body.templateName !== undefined || body.templateLanguage !== undefined;
  if (isEditing) {
    const eventType = String(body.eventType || "").trim();
    const templateName = String(body.templateName || "").trim();
    const templateLanguage = String(body.templateLanguage || "").trim();
    if (!eventType || !templateName || !templateLanguage) {
      return NextResponse.json({ error: "Evento, template e idioma são obrigatórios." }, { status: 400 });
    }
    changes.event_type = eventType;
    changes.product_id = String(body.productId || "").trim() || null;
    changes.template_name = templateName;
    changes.template_language = templateLanguage;
    changes.variable_mapping = body.variableMapping && typeof body.variableMapping === "object" ? body.variableMapping : {};
  }

  if (!Object.keys(changes).length) return NextResponse.json({ error: "Nenhuma alteração informada." }, { status: 400 });

  try {
    if (isEditing && body.connectionId !== undefined) {
      changes.connection_id = connectionIdSchema.parse(body.connectionId);
      await findTemplate(changes.template_name!, changes.template_language, changes.connection_id);
    }
    const automation = await updateAutomation(id, changes);
    return NextResponse.json({ ok: true, automation });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Falha ao atualizar automação." }, { status: 500 });
  }
}
