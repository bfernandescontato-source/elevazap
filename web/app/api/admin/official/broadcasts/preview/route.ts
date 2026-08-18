import { NextRequest, NextResponse } from "next/server";
import { guardInternalAdminMutation } from "@/lib/internal-admin";
import { getFlow } from "@/modules/official-whatsapp/server/flows";
import { findTemplate } from "@/modules/official-whatsapp/server/templates";
import { classifyContacts, type RawContact } from "@/modules/official-whatsapp/server/broadcast-contacts";
import { renderTemplateBodyPreview, type EventContext } from "@/modules/official-whatsapp/server/variable-resolver";

export async function POST(request: NextRequest) {
  const guard = await guardInternalAdminMutation(request, "official_broadcast_preview_ip");
  if (guard) return guard;

  const body = await request.json().catch(() => null) as { flowId?: string; contacts?: RawContact[] } | null;
  const flowId = String(body?.flowId || "");
  const contacts = Array.isArray(body?.contacts) ? body!.contacts! : [];
  if (!flowId || !contacts.length) return NextResponse.json({ error: "Selecione um fluxo e envie os contatos." }, { status: 400 });

  const flow = await getFlow(flowId);
  if (!flow) return NextResponse.json({ error: "Fluxo não encontrado." }, { status: 404 });

  let template;
  try {
    template = await findTemplate(flow.initial_template_name, flow.initial_template_language);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Falha ao consultar template." }, { status: 400 });
  }
  const bodyComponent = template.components.find((component) => component.type === "BODY");

  const classified = classifyContacts(contacts);
  const previewContacts = classified.validContacts.slice(0, 3).map((contact) => {
    const context: EventContext = {
      customerName: contact.name, productName: contact.product, customerEmail: contact.email,
      customerPhone: contact.phone, amountCents: null, paymentUrl: null, accessUrl: null
    };
    return { name: contact.name, text: renderTemplateBodyPreview(bodyComponent?.text || "", flow.variable_mapping.body, context, template.parameterFormat) };
  });

  return NextResponse.json({
    totalRows: classified.totalRows, validCount: classified.validCount, duplicateCount: classified.duplicateCount, invalidCount: classified.invalidCount,
    previewContacts,
    flow: {
      name: flow.name, templateName: flow.initial_template_name, templateCategory: template.category,
      buttonLabel: flow.official_quick_reply_actions?.button_label || flow.official_quick_reply_actions?.payload
    }
  });
}
