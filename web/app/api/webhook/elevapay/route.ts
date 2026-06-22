import { NextRequest, NextResponse } from "next/server";
import { env } from "@/lib/env";
import { maskPhone, normalizeBrazilianPhone } from "@/lib/phone";
import { clientIp, persistentRateLimit } from "@/lib/security";
import { supabaseAdmin } from "@/lib/supabase";
import { webhookPayloadSchema } from "@/lib/schemas";

export async function POST(request: NextRequest) {
  const e = env();
  if (request.headers.get("x-elevapay-token") !== e.ELEVAPAY_WEBHOOK_TOKEN) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  const allowed = await persistentRateLimit(clientIp(request), "webhook_ip", 120, 60);
  if (!allowed) return NextResponse.json({ error: "Muitas requisições." }, { status: 429 });
  const parsed = webhookPayloadSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Payload inválido." }, { status: 400 });
  const payload = parsed.data;
  if (payload.event !== "compra.aprovada") return NextResponse.json({ ok: true, ignored: true });
  let phone = "";
  try { phone = normalizeBrazilianPhone(payload.telefone); } catch {
    return NextResponse.json({ ok: true, invalid_phone: true });
  }
  const { data: config } = await supabaseAdmin().from("config").select("welcome_message").limit(1).maybeSingle();
  const message = (config?.welcome_message || "Olá {{nome}}, bem-vindo(a)!").replaceAll("{{nome}}", payload.nome);
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
