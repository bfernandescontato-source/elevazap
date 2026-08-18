import { timingSafeEqual } from "node:crypto";
import { after, NextRequest, NextResponse } from "next/server";
import { env } from "@/lib/env";
import { captureHublaEvent, extractEventType, extractProviderEventId, extractRelevantHeaders } from "@/modules/official-whatsapp/server/hubla-events";
import { parseHublaEvent } from "@/modules/official-whatsapp/server/hubla-parser";
import { processHublaEvent } from "@/modules/official-whatsapp/server/hubla-processor";

function secretsMatch(provided: string, expected: string) {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

// Endpoint público — não depende de sessão de usuário; a autenticação é só o segredo na URL.
// Responde rápido (só grava o evento bruto) e processa a automação/envio Meta depois da
// resposta via after(), no mesmo padrão já usado em app/c/[slug]/route.ts — sem fila nova.
export async function POST(request: NextRequest, { params }: { params: Promise<{ secret: string }> }) {
  const { secret } = await params;
  const configured = env().HUBLA_WEBHOOK_SECRET;
  if (!configured || !secretsMatch(secret, configured)) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  if (body === null) return NextResponse.json({ error: "JSON inválido." }, { status: 400 });

  const parsed = parseHublaEvent(body);

  try {
    const result = await captureHublaEvent({
      payload: body,
      headers: extractRelevantHeaders(request.headers),
      providerEventId: parsed.providerEventId ?? extractProviderEventId(body),
      eventType: parsed.eventType ?? extractEventType(body),
      productId: parsed.productId,
      productName: parsed.productName,
      customerName: parsed.customerName,
      customerPhone: parsed.customerPhone
    });
    if (!result.duplicate && result.id) {
      after(() => processHublaEvent(result.id as string, parsed));
    }
    return NextResponse.json({ ok: true, duplicate: result.duplicate });
  } catch {
    return NextResponse.json({ error: "Falha ao registrar evento." }, { status: 500 });
  }
}
