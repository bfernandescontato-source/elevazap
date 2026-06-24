import bcrypt from "bcryptjs";
import { NextRequest, NextResponse } from "next/server";
import { maskPhone, normalizeBrazilianPhone } from "@/lib/phone";
import { clientIp, persistentRateLimit } from "@/lib/security";
import { supabaseAdmin } from "@/lib/supabase";
import { buildIdempotencyKey, normalizeWebhookPayload, renderAutomationTemplate } from "@/lib/webhook-automation";

function redactSecrets(value: any): any {
  if (Array.isArray(value)) return value.map(redactSecrets);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, val]) => {
      if (["apikey", "api_key", "secret", "token", "password"].includes(key.toLowerCase())) return [key, "[redacted]"];
      return [key, redactSecrets(val)];
    }));
  }
  return value;
}

async function createEvent(row: any) {
  const { data, error } = await supabaseAdmin().from("webhook_events").insert(row).select("*").single();
  if (error) throw error;
  return data;
}

async function authPassed(request: NextRequest, body: any, rule: any) {
  if (rule.auth_type === "none") return { ok: true, error: "" };
  if (!rule.auth_secret_hash) return { ok: false, error: "Autenticação sem segredo configurado." };
  const received = rule.auth_type === "header"
    ? request.headers.get(rule.auth_header_name || "")
    : body?.apiKey;
  if (!received) return { ok: false, error: rule.auth_type === "header" ? "Header não encontrado." : "apiKey não encontrada." };
  const ok = await bcrypt.compare(String(received), rule.auth_secret_hash);
  return { ok, error: ok ? "" : "Autenticação inválida." };
}

function listMatches(mode: string, allowed: string[], value: string) {
  return mode !== "specific" || (Boolean(value) && allowed.includes(value));
}

export async function POST(request: NextRequest, { params }: { params: { token: string } }) {
  const allowed = await persistentRateLimit(clientIp(request), "webhook_elevazap_ip", 240, 60);
  if (!allowed) return NextResponse.json({ error: "Muitas requisições." }, { status: 429 });

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Payload inválido." }, { status: 400 });
  const rawPayload = redactSecrets(body);
  const sb = supabaseAdmin();
  const { data: rule } = await sb
    .from("webhook_rules")
    .select("*, webhook_message_templates(*)")
    .eq("webhook_token", params.token)
    .maybeSingle();
  if (!rule) return NextResponse.json({ error: "Regra não encontrada." }, { status: 404 });

  const auth = await authPassed(request, body, rule);
  if (!auth.ok) {
    await createEvent({
      webhook_rule_id: rule.id,
      raw_payload: rawPayload,
      conditions_result: { authPassed: false },
      http_status: 401,
      status: "auth_error",
      error_message: auth.error
    });
    return NextResponse.json({ error: auth.error }, { status: 401 });
  }

  const normalized = normalizeWebhookPayload(body);
  if (normalized.event_type === "unknown" && (rule.selected_event_types || []).length === 1) {
    normalized.event_type = rule.selected_event_types[0];
  }
  const idempotencyKey = buildIdempotencyKey(rule.id, normalized, rawPayload);
  const base = {
    webhook_rule_id: rule.id,
    external_event_id: normalized.external_event_id,
    idempotency_key: idempotencyKey,
    event_type: normalized.event_type,
    raw_payload: rawPayload,
    normalized_payload: normalized,
    recipient_name: normalized.customer.name,
    recipient_email: normalized.customer.email,
    whatsapp_account_id: rule.whatsapp_account_id
  };

  const { data: duplicate } = await sb.from("webhook_events").select("id").eq("webhook_rule_id", rule.id).eq("idempotency_key", idempotencyKey).maybeSingle();
  if (duplicate) {
    await createEvent({
      ...base,
      idempotency_key: `${idempotencyKey}:duplicate:${Date.now()}`,
      status: "duplicated",
      http_status: 200,
      message: "Evento duplicado. Disparo não reenviado.",
      conditions_result: { authPassed: true, duplicated: true },
      processed_at: new Date().toISOString()
    });
    return NextResponse.json({ ok: true, duplicated: true });
  }

  const conditions = {
    authPassed: true,
    activeRule: rule.status === "active",
    eventMatched: (rule.selected_event_types || []).includes(normalized.event_type),
    productMatched: listMatches(rule.selected_product_mode, rule.product_ids || [], normalized.product_id),
    offerMatched: listMatches(rule.selected_offer_mode, rule.offer_ids || [], normalized.offer_id),
    templateFound: false,
    phoneFound: false,
    whatsappAccountConnected: true
  };
  const template = (rule.webhook_message_templates || []).find((item: any) => item.event_type === normalized.event_type && item.status === "active");
  conditions.templateFound = Boolean(template?.template_body);

  let event = await createEvent({ ...base, conditions_result: conditions, http_status: 200, status: "received" });
  const fail = async (status: string, message: string, httpStatus = 200) => {
    await sb.from("webhook_events").update({
      status,
      http_status: httpStatus,
      message,
      error_message: status === "failed" || status === "validation_error" ? message : null,
      conditions_result: conditions,
      processed_at: new Date().toISOString()
    }).eq("id", event.id);
    return NextResponse.json({ ok: true, status, message }, { status: httpStatus });
  };

  if (!conditions.activeRule) return fail("ignored", "Regra inativa.");
  if (!conditions.eventMatched) return fail("ignored", "Evento não selecionado na regra.");
  if (!conditions.productMatched) return fail("ignored", "Produto não corresponde à regra.");
  if (!conditions.offerMatched) return fail("ignored", "Oferta não corresponde à regra.");
  if (!conditions.templateFound) return fail("failed", "Template não configurado para este evento.");

  let phone = "";
  try {
    phone = normalizeBrazilianPhone(normalized.customer.phone);
    conditions.phoneFound = true;
  } catch {
    return fail("failed", "Telefone inválido ou ausente.");
  }

  const { rendered, warnings } = renderAutomationTemplate(template.template_body, normalized, rawPayload, rule.fixed_variables || {});
  const { data: envio, error } = await sb.from("envios").insert({
    source: "webhook_elevazap",
    event: normalized.event_type,
    idempotency_key: idempotencyKey,
    order_id: normalized.order_id,
    transaction_id: normalized.payment_id || normalized.external_event_id,
    nome: normalized.customer.name,
    telefone: phone,
    telefone_mascarado: maskPhone(phone),
    produto: normalized.product_name,
    email: normalized.customer.email,
    mensagem_enviada: rendered,
    status: "pendente"
  }).select("id").single();

  if (error) return fail("failed", error.message);
  await sb.from("webhook_events").update({
    status: "queued",
    message: "Disparo colocado na fila.",
    rendered_message: rendered,
    template_used: template.template_body,
    recipient_phone: phone,
    envio_id: envio.id,
    warnings,
    conditions_result: conditions,
    processed_at: new Date().toISOString()
  }).eq("id", event.id);
  return NextResponse.json({ ok: true, queued: true });
}
