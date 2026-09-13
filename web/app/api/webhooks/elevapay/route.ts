import { timingSafeEqual } from "node:crypto";
import { after, NextRequest, NextResponse } from "next/server";
import { env } from "@/lib/env";
import { captureElevaPayEvent, extractRelevantHeaders } from "@/modules/official-whatsapp/server/hubla-events";
import { extractElevaPayCredential, parseElevaPayOrderPaid } from "@/modules/official-whatsapp/server/elevapay-parser";
import { processHublaEvent } from "@/modules/official-whatsapp/server/hubla-processor";

function tokenMatches(provided: string | null, expected: string) {
  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

// Configurar na ElevaPay: evento "Venda aprovada" (order.paid) e header
// x-elevapay-token. A regra já limita este endpoint a compras aprovadas.
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  if (body === null) return NextResponse.json({ error: "JSON inválido." }, { status: 400 });
  if (!tokenMatches(extractElevaPayCredential(request.headers, body), env().ELEVAPAY_WEBHOOK_TOKEN)) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }

  const parsed = parseElevaPayOrderPaid(body);
  try {
    const result = await captureElevaPayEvent({
      payload: body,
      headers: extractRelevantHeaders(request.headers),
      providerEventId: parsed.providerEventId,
      productId: parsed.productId,
      productName: parsed.productName,
      customerName: parsed.customerName,
      customerPhone: parsed.customerPhone
    });
    if (!result.duplicate && result.id) after(() => processHublaEvent(result.id as string, parsed));
    return NextResponse.json({ ok: true, duplicate: result.duplicate });
  } catch {
    return NextResponse.json({ error: "Falha ao registrar evento." }, { status: 500 });
  }
}
