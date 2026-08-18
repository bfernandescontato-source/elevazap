import { NextRequest, NextResponse } from "next/server";
import { guardInternalAdminMutation } from "@/lib/internal-admin";
import { buildTestComponents, findTemplate } from "@/modules/official-whatsapp/server/templates";
import { sendWhatsAppTemplate } from "@/modules/official-whatsapp/server/send-template";
import { logMessageAttempt } from "@/modules/official-whatsapp/server/messages-store";
import { OFFICIAL_ERROR_LABELS, officialErrorCode, officialErrorMessage, officialErrorMetaDetails } from "@/modules/official-whatsapp/server/errors";

export async function POST(request: NextRequest) {
  const guard = await guardInternalAdminMutation(request, "official_test_send_ip");
  if (guard) return guard;

  const body = (await request.json().catch(() => null)) as { phone?: string; templateName?: string } | null;
  const phone = String(body?.phone || "").trim();
  const templateName = String(body?.templateName || "").trim();
  if (!phone || !templateName) return NextResponse.json({ error: "Informe telefone e template." }, { status: 400 });

  try {
    const template = await findTemplate(templateName);
    const components = buildTestComponents(template);
    const result = await sendWhatsAppTemplate({ phone, templateName: template.name, language: template.language, components });
    // "accepted": a Meta apenas confirmou o recebimento síncrono da requisição.
    // sent/delivered/read chegam depois pelo webhook de status (fase 5).
    await logMessageAttempt({
      eventId: null,
      phone: result.phone,
      templateName: template.name,
      templateLanguage: template.language,
      status: "accepted",
      metaMessageId: result.messageId || null,
      requestPayload: result.requestPayload,
      responsePayload: result.response
    });
    return NextResponse.json({ ok: true, messageId: result.messageId });
  } catch (error) {
    const code = officialErrorCode(error);
    const message = officialErrorMessage(error);
    const metaError = officialErrorMetaDetails(error);
    const errorSummary = [
      code,
      metaError?.httpStatus ? `HTTP ${metaError.httpStatus}` : null,
      metaError?.code !== undefined ? `meta_code=${metaError.code}` : null,
      metaError?.subcode !== undefined ? `subcode=${metaError.subcode}` : null,
      message
    ].filter(Boolean).join(" · ");
    await logMessageAttempt({
      eventId: null,
      phone,
      templateName,
      templateLanguage: "pt_BR",
      status: "failed",
      error: errorSummary.slice(0, 500),
      responsePayload: metaError ? { error: metaError } : null
    }).catch(() => {});
    return NextResponse.json({ error: OFFICIAL_ERROR_LABELS[code] || message, code, metaError }, { status: 400 });
  }
}
