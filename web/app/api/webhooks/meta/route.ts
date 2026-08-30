import { createHmac, timingSafeEqual } from "node:crypto";
import { after, NextRequest, NextResponse } from "next/server";
import { listWebhookCredentials, webhookVerifyTokenMatches } from "@/modules/official-whatsapp/server/official-connections";
import { captureMetaButtonClick } from "@/modules/official-whatsapp/server/hubla-events";
import { processButtonClickEvent } from "@/modules/official-whatsapp/server/flow-processor";
import { applyMetaMessageStatus } from "@/modules/official-whatsapp/server/messages-store";

// Handshake de assinatura do webhook (feito uma vez, ao configurar na Meta).
export async function GET(request: NextRequest) {
  const mode = request.nextUrl.searchParams.get("hub.mode");
  const token = request.nextUrl.searchParams.get("hub.verify_token");
  const challenge = request.nextUrl.searchParams.get("hub.challenge");
  if (mode !== "subscribe" || !token || token.length > 512 || !challenge || !(await webhookVerifyTokenMatches(token))) {
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

async function persistMetaStatus(status: unknown, connectionId: string | null) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const result = await applyMetaMessageStatus(status, connectionId);
    if (result.matched || result.ignored) return;
    // O webhook pode chegar milissegundos antes do log do retorno síncrono do envio.
    await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)));
  }
}

// Endpoint público — segurança real é a assinatura X-Hub-Signature-256 (HMAC do corpo com o
// App Secret), não o verify_token (que só serve pro handshake de GET). Responde rápido e
// processa depois via after() — mesmo padrão do webhook da Hubla.
export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  const credentials = (await listWebhookCredentials()).filter((credential) => signatureValid(rawBody, request.headers.get("x-hub-signature-256"), credential.appSecret));
  if (!credentials.length) {
    return NextResponse.json({ error: "Assinatura inválida." }, { status: 401 });
  }

  let body: any;
  try {
    body = JSON.parse(rawBody || "null");
  } catch {
    return NextResponse.json({ error: "JSON inválido." }, { status: 400 });
  }
  if (!Array.isArray(body?.entry)) return NextResponse.json({ error: "Formato inválido." }, { status: 400 });
  const messages: any[] = [];
  const statuses: any[] = [];
  for (const entry of body.entry) {
    for (const change of Array.isArray(entry?.changes) ? entry.changes : []) {
      const value = change?.value;
      const credential = credentials.find((item) => item.phoneNumberId === value?.metadata?.phone_number_id && (!item.wabaId || item.wabaId === entry.id));
      // A valid signature from account A cannot authorize events for account B.
      // Unknown numbers never fall back to the legacy sender.
      if (!credential) continue;
      for (const message of Array.isArray(value?.messages) ? value.messages : []) messages.push({ ...message, connectionId: credential.id });
      if (Array.isArray(value?.statuses)) statuses.push(...value.statuses.map((status: any) => ({ status, connectionId: credential.id })));
    }
  }
  const buttonClicks = messages.filter((message) => message?.type === "button" && message?.button?.payload && message?.from && message?.id);

  if (statuses.length) {
    after(async () => {
      for (const status of statuses) {
        await persistMetaStatus(status.status, status.connectionId).catch((error) => console.error("[official-whatsapp] Falha ao persistir status da Meta:", error));
      }
    });
  }

  for (const click of buttonClicks) {
    const result = await captureMetaButtonClick({
      payload: click,
      providerEventId: click.id,
      buttonPayload: click.button.payload,
      fromPhone: click.from,
      connectionId: click.connectionId
    });
    if (!result.duplicate && result.id) {
      after(() => processButtonClickEvent(result.id as string, click, click.connectionId));
    }
  }

  return NextResponse.json({ ok: true });
}
