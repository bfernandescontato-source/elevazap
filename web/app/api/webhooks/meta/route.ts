import { createHmac, timingSafeEqual } from "node:crypto";
import { after, NextRequest, NextResponse } from "next/server";
import { env } from "@/lib/env";
import { captureMetaButtonClick } from "@/modules/official-whatsapp/server/hubla-events";
import { processButtonClickEvent } from "@/modules/official-whatsapp/server/flow-processor";

// Handshake de assinatura do webhook (feito uma vez, ao configurar na Meta).
export async function GET(request: NextRequest) {
  const configured = env().META_WEBHOOK_VERIFY_TOKEN;
  const mode = request.nextUrl.searchParams.get("hub.mode");
  const token = request.nextUrl.searchParams.get("hub.verify_token");
  const challenge = request.nextUrl.searchParams.get("hub.challenge");
  if (!configured || mode !== "subscribe" || token !== configured || !challenge) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 403 });
  }
  return new NextResponse(challenge, { status: 200, headers: { "content-type": "text/plain" } });
}

function signatureValid(rawBody: string, header: string | null, appSecret: string) {
  if (!header?.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", appSecret).update(rawBody).digest("hex");
  const provided = header.slice("sha256=".length);
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(provided, "hex");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

// Endpoint público — segurança real é a assinatura X-Hub-Signature-256 (HMAC do corpo com o
// App Secret), não o verify_token (que só serve pro handshake de GET). Responde rápido e
// processa depois via after() — mesmo padrão do webhook da Hubla.
export async function POST(request: NextRequest) {
  const appSecret = env().META_APP_SECRET;
  const rawBody = await request.text();
  if (!appSecret || !signatureValid(rawBody, request.headers.get("x-hub-signature-256"), appSecret)) {
    return NextResponse.json({ error: "Assinatura inválida." }, { status: 401 });
  }

  const body = JSON.parse(rawBody || "null");
  const messages: any[] = (body?.entry || []).flatMap((entry: any) => (entry?.changes || []).flatMap((change: any) => change?.value?.messages || []));
  const buttonClicks = messages.filter((message) => message?.type === "button" && message?.button?.payload && message?.from && message?.id);

  for (const click of buttonClicks) {
    const result = await captureMetaButtonClick({
      payload: click,
      providerEventId: click.id,
      buttonPayload: click.button.payload,
      fromPhone: click.from
    });
    if (!result.duplicate && result.id) {
      after(() => processButtonClickEvent(result.id as string, click));
    }
  }

  return NextResponse.json({ ok: true });
}
