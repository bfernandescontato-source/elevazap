import { normalizeBrazilianPhone } from "@/lib/phone";
import { graphRequest, metaIdentifiers } from "./meta-client";
import { OfficialWhatsAppError } from "./errors";

export type TemplateComponent = Record<string, unknown>;

export async function sendWhatsAppTemplate(input: { phone: string; templateName: string; language: string; components?: TemplateComponent[]; connectionId?: string | null }) {
  let phone: string;
  try {
    phone = normalizeBrazilianPhone(input.phone);
  } catch {
    throw new OfficialWhatsAppError("INVALID_PHONE", "Não foi possível normalizar o telefone com segurança.");
  }

  const { phoneNumberId, connectionId } = await metaIdentifiers(input.connectionId, true);
  const requestPayload = {
    messaging_product: "whatsapp",
    to: phone,
    type: "template",
    template: {
      name: input.templateName,
      language: { code: input.language },
      ...(input.components?.length ? { components: input.components } : {})
    }
  };

  const response = await graphRequest(`/${phoneNumberId}/messages`, { method: "POST", body: JSON.stringify(requestPayload) }, input.connectionId);
  return { phone, requestPayload, response, messageId: response?.messages?.[0]?.id as string | undefined, phoneNumberId, connectionId };
}
