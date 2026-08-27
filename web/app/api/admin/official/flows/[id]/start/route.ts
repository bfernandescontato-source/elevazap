import { NextRequest, NextResponse } from "next/server";
import { guardInternalAdminMutation } from "@/lib/internal-admin";
import { startFlow } from "@/modules/official-whatsapp/server/flow-processor";
import { OFFICIAL_ERROR_LABELS, officialErrorCode, officialErrorMessage } from "@/modules/official-whatsapp/server/errors";

// Início manual de fluxo — usado pro teste da fase A. A fase B (upload/broadcast) vai chamar
// startFlow() diretamente pelo processador em lote, não por essa rota (que é 1 contato por vez).
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const guard = await guardInternalAdminMutation(request, "official_flow_start_ip");
  if (guard) return guard;

  const body = await request.json().catch(() => null) as Record<string, any> | null;
  const phone = String(body?.phone || "").trim();
  if (!phone) return NextResponse.json({ error: "Informe o telefone." }, { status: 400 });

  try {
    const result = await startFlow({
      flowId: id,
      rawPhone: phone,
      context: {
        customerName: body?.customerName || null,
        productName: body?.productName || null,
        customerEmail: body?.customerEmail || null,
        customerPhone: phone,
        amountCents: typeof body?.amountCents === "number" ? body.amountCents : null,
        paymentUrl: body?.paymentUrl || null,
        accessUrl: body?.accessUrl || null
      },
      source: "manual",
      sourceReference: null
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const code = officialErrorCode(error);
    // A Graph API devolve uma causa segura e específica (template, variável, limite etc.).
    // Preservá-la aqui evita que o painel esconda o diagnóstico atrás de "falha ao enviar".
    return NextResponse.json({ error: officialErrorMessage(error) || OFFICIAL_ERROR_LABELS[code], code }, { status: 400 });
  }
}
