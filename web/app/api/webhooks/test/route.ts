import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { maskPhone, normalizeBrazilianPhone } from "@/lib/phone";
import { guardAdminMutation } from "@/lib/security";
import { supabaseAdmin } from "@/lib/supabase";
import { renderAutomationTemplate, sampleWebhookVariables } from "@/lib/webhook-automation";

export async function POST(request: NextRequest) {
  const guard = await guardAdminMutation(request, "webhook_test");
  if (guard) return guard;
  try {
    const body = await request.json();
    const ruleId = String(body.rule_id || "");
    const eventType = String(body.event_type || "order.paid");
    const phone = normalizeBrazilianPhone(String(body.phone || ""));
    const { data: rule, error } = await supabaseAdmin()
      .from("webhook_rules")
      .select("*, webhook_message_templates(*)")
      .eq("id", ruleId)
      .single();
    if (error || !rule) throw new Error("Regra não encontrada.");
    const template = (rule.webhook_message_templates || []).find((item: any) => item.event_type === eventType);
    if (!template?.template_body) throw new Error("Template não configurado para este evento.");
    const normalized = {
      event_type: eventType,
      external_event_id: `test_${randomUUID()}`,
      order_id: "order_test",
      payment_id: "pay_test",
      product_id: "prod_123",
      product_name: "Shop Lab",
      offer_id: "offer_123",
      offer_name: "Aula ao vivo",
      customer: { name: "Maria Silva", email: "maria@email.com", phone },
      amount: "R$ 9,90",
      currency: "BRL",
      paid_at: "24/06/2026 09:50",
      pix_code: "000201010212...",
      pix_qr_code: "https://exemplo.com/qrcode",
      refund_reason: "Solicitação do cliente"
    };
    const { rendered, warnings } = renderAutomationTemplate(template.template_body, normalized, sampleWebhookVariables, rule.fixed_variables || {});
    const idempotencyKey = `webhook-test:${rule.id}:${Date.now()}`;
    const { data: envio } = await supabaseAdmin().from("envios").insert({
      source: "webhook_test",
      event: eventType,
      idempotency_key: idempotencyKey,
      order_id: normalized.order_id,
      transaction_id: normalized.payment_id,
      nome: normalized.customer.name,
      telefone: phone,
      telefone_mascarado: maskPhone(phone),
      produto: normalized.product_name,
      email: normalized.customer.email,
      mensagem_enviada: rendered,
      status: "pendente"
    }).select("id").single();
    await supabaseAdmin().from("webhook_events").insert({
      webhook_rule_id: rule.id,
      external_event_id: normalized.external_event_id,
      idempotency_key: idempotencyKey,
      event_type: eventType,
      raw_payload: sampleWebhookVariables,
      normalized_payload: normalized,
      conditions_result: { authPassed: true, eventMatched: true, productMatched: true, offerMatched: true, templateFound: true, phoneFound: true, whatsappAccountConnected: true, test: true },
      http_status: 200,
      status: "queued",
      message: "Teste colocado na fila.",
      template_used: template.template_body,
      rendered_message: rendered,
      recipient_phone: phone,
      recipient_name: normalized.customer.name,
      recipient_email: normalized.customer.email,
      whatsapp_account_id: rule.whatsapp_account_id,
      envio_id: envio?.id,
      warnings,
      processed_at: new Date().toISOString()
    });
    return NextResponse.json({ ok: true, rendered });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Falha ao enviar teste." }, { status: 400 });
  }
}
