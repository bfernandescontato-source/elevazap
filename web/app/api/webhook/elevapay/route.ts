import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { env } from "@/lib/env";
import { maskPhone, normalizeBrazilianPhone } from "@/lib/phone";
import { clientIp, persistentRateLimit } from "@/lib/security";
import { supabaseAdmin } from "@/lib/supabase";
import { sendFlowWebhookPayloadSchema, webhookPayloadSchema } from "@/lib/schemas";
import { defaultApprovedPurchaseMessage, renderApprovedPurchaseMessage } from "@/lib/message-template";

function authorized(request: NextRequest, body: any, token: string) {
  const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  return request.headers.get("x-elevapay-token") === token
    || request.headers.get("x-api-key") === token
    || bearer === token
    || body?.apiKey === token;
}

function normalizePayload(body: any) {
  const native = webhookPayloadSchema.safeParse(body);
  if (native.success) {
    if (native.data.event !== "compra.aprovada" && native.data.event !== "order.paid") return { ignored: true as const };
    return { payload: native.data };
  }

  const sendflow = sendFlowWebhookPayloadSchema.safeParse(body);
  if (!sendflow.success) return { error: true as const };
  const id = body.transaction_id || body.transactionId || body.order_id || body.orderId || body.saleId || body.id || randomUUID();
  return {
    payload: {
      event: "order.paid",
      order_id: String(body.order_id || body.orderId || id),
      transaction_id: String(id),
      nome: sendflow.data.name,
      telefone: sendflow.data.phoneNumber,
      produto: String(body.produto || body.product || body.productName || "Compra aprovada"),
      email: sendflow.data.email
    }
  };
}

export async function POST(request: NextRequest) {
  const e = env();
  const body = await request.json().catch(() => null);
  if (!authorized(request, body, e.ELEVAPAY_WEBHOOK_TOKEN)) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  const allowed = await persistentRateLimit(clientIp(request), "webhook_ip", 120, 60);
  if (!allowed) return NextResponse.json({ error: "Muitas requisições." }, { status: 429 });
  const normalized = normalizePayload(body);
  if ("ignored" in normalized) return NextResponse.json({ ok: true, ignored: true });
  if ("error" in normalized) return NextResponse.json({ error: "Payload inválido." }, { status: 400 });
  const { payload } = normalized;
  let phone = "";
  try { phone = normalizeBrazilianPhone(payload.telefone); } catch {
    return NextResponse.json({ ok: true, invalid_phone: true });
  }
  const { data: config } = await supabaseAdmin().from("config").select("welcome_message").limit(1).maybeSingle();
  const message = renderApprovedPurchaseMessage(config?.welcome_message || defaultApprovedPurchaseMessage, {
    nome: payload.nome,
    produto: payload.produto,
    email: payload.email,
    telefone: phone,
    order_id: payload.order_id,
    transaction_id: payload.transaction_id
  });
  const { data, error } = await supabaseAdmin().rpc("create_envio_from_webhook", {
    p_source: "elevapay",
    p_event: payload.event,
    p_idempotency_key: payload.transaction_id,
    p_order_id: payload.order_id,
    p_transaction_id: payload.transaction_id,
    p_nome: payload.nome,
    p_telefone: phone,
    p_telefone_mascarado: maskPhone(phone),
    p_produto: payload.produto,
    p_email: payload.email,
    p_mensagem_enviada: message
  });
  if (error) return NextResponse.json({ error: "Falha ao gravar job." }, { status: 500 });
  return NextResponse.json(data || { ok: true });
}
