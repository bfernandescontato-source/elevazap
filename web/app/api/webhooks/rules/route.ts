import { randomBytes } from "crypto";
import bcrypt from "bcryptjs";
import { NextRequest, NextResponse } from "next/server";
import { guardAdminMutation, requireAdmin } from "@/lib/security";
import { supabaseAdmin } from "@/lib/supabase";

const allowedEvents = new Set(["order.paid", "pix.generated", "order.refunded"]);

function sanitizeList(value: unknown) {
  return Array.isArray(value) ? value.map((item) => String(item).trim()).filter(Boolean) : [];
}

function sanitizeTemplates(templates: any, events: string[]) {
  const out: Record<string, string> = {};
  for (const event of events) {
    const body = String(templates?.[event] || "").trim();
    if (!body) throw new Error(`Template obrigatório para ${event}.`);
    out[event] = body;
  }
  return out;
}

function sanitizeVariables(value: any) {
  const result: Record<string, string> = {};
  for (const item of Array.isArray(value) ? value : []) {
    const key = String(item.key || "").trim();
    const val = String(item.value || "").trim();
    if (key && val) result[key] = val;
  }
  return result;
}

async function payloadToRule(body: any, existing?: any) {
  const events = sanitizeList(body.selected_event_types).filter((event) => allowedEvents.has(event));
  if (!String(body.name || "").trim()) throw new Error("Informe o nome da regra.");
  if (!events.length) throw new Error("Selecione pelo menos um evento.");
  const templates = sanitizeTemplates(body.templates, events);
  const auth_type = ["none", "header", "body_api_key"].includes(body.auth_type) ? body.auth_type : "none";
  if (auth_type === "header" && !String(body.auth_header_name || "").trim()) throw new Error("Informe o nome do header.");
  if (auth_type !== "none" && !existing?.auth_secret_hash && !String(body.auth_secret || "").trim()) throw new Error("Informe o valor secreto.");

  let auth_secret_hash = existing?.auth_secret_hash || null;
  if (String(body.auth_secret || "").trim()) auth_secret_hash = await bcrypt.hash(String(body.auth_secret), 10);

  return {
    rule: {
      name: String(body.name).trim(),
      status: body.status === "inactive" ? "inactive" : "active",
      payload_format: String(body.payload_format || "generic").trim(),
      auth_type,
      auth_header_name: auth_type === "header" ? String(body.auth_header_name || "").trim() : null,
      auth_secret_hash: auth_type === "none" ? null : auth_secret_hash,
      selected_product_mode: body.selected_product_mode === "specific" ? "specific" : "all",
      product_ids: sanitizeList(body.product_ids),
      selected_offer_mode: body.selected_offer_mode === "specific" ? "specific" : "all",
      offer_ids: sanitizeList(body.offer_ids),
      selected_event_types: events,
      whatsapp_account_id: String(body.whatsapp_account_id || "default").trim(),
      fixed_variables: sanitizeVariables(body.fixed_variables)
    },
    templates
  };
}

async function replaceTemplates(ruleId: string, templates: Record<string, string>) {
  const sb = supabaseAdmin();
  await sb.from("webhook_message_templates").delete().eq("webhook_rule_id", ruleId);
  const rows = Object.entries(templates).map(([event_type, template_body]) => ({ webhook_rule_id: ruleId, event_type, template_body }));
  if (rows.length) {
    const { error } = await sb.from("webhook_message_templates").insert(rows);
    if (error) throw error;
  }
}

function publicRule(rule: any) {
  return { ...rule, auth_secret_hash: undefined, auth_secret_configured: Boolean(rule.auth_secret_hash) };
}

export async function GET() {
  const guard = await requireAdmin();
  if (guard) return guard;
  const { data, error } = await supabaseAdmin()
    .from("webhook_rules")
    .select("*, webhook_message_templates(*)")
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json((data || []).map(publicRule));
}

export async function POST(request: NextRequest) {
  const guard = await guardAdminMutation(request, "webhook_rules");
  if (guard) return guard;
  try {
    const body = await request.json();
    const { rule, templates } = await payloadToRule(body);
    const { data, error } = await supabaseAdmin().from("webhook_rules").insert({
      ...rule,
      webhook_token: randomBytes(18).toString("base64url")
    }).select("*").single();
    if (error) throw error;
    await replaceTemplates(data.id, templates);
    return NextResponse.json({ ok: true, rule: publicRule(data) });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Falha ao salvar regra." }, { status: 400 });
  }
}

export async function PATCH(request: NextRequest) {
  const guard = await guardAdminMutation(request, "webhook_rules");
  if (guard) return guard;
  try {
    const body = await request.json();
    const id = String(body.id || "");
    const { data: existing, error: findError } = await supabaseAdmin().from("webhook_rules").select("*").eq("id", id).single();
    if (findError || !existing) throw new Error("Regra não encontrada.");
    const { rule, templates } = await payloadToRule(body, existing);
    const { data, error } = await supabaseAdmin().from("webhook_rules").update({ ...rule, updated_at: new Date().toISOString() }).eq("id", id).select("*").single();
    if (error) throw error;
    await replaceTemplates(id, templates);
    return NextResponse.json({ ok: true, rule: publicRule(data) });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Falha ao salvar regra." }, { status: 400 });
  }
}

export async function DELETE(request: NextRequest) {
  const guard = await guardAdminMutation(request, "webhook_rules");
  if (guard) return guard;
  const body = await request.json().catch(() => ({}));
  const { error } = await supabaseAdmin().from("webhook_rules").delete().eq("id", String(body.id || ""));
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
