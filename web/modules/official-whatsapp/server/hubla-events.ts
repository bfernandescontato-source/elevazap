import { supabaseAdmin } from "@/lib/supabase";
import { normalizeBrazilianPhone } from "@/lib/phone";

const ID_CANDIDATE_PATHS: string[][] = [
  ["event_id"], ["id"], ["transaction_id"], ["invoice_id"], ["payment_id"],
  ["data", "id"], ["event", "id"], ["data", "transaction_id"], ["event", "transaction_id"]
];

function readPath(body: unknown, path: string[]): string | null {
  let current: unknown = body;
  for (const key of path) {
    if (current === null || typeof current !== "object") return null;
    current = (current as Record<string, unknown>)[key];
  }
  if (typeof current === "string" && current.trim()) return current.trim();
  if (typeof current === "number") return String(current);
  return null;
}

// Fallback genérico para tipos de evento que parseHublaEvent ainda não conhece —
// tenta nomes de campo comuns em webhooks de pagamento antes de desistir e usar null.
export function extractProviderEventId(body: unknown): string | null {
  for (const path of ID_CANDIDATE_PATHS) {
    const value = readPath(body, path);
    if (value) return value;
  }
  return null;
}

export function extractEventType(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const value = (body as Record<string, unknown>).type ?? (body as Record<string, unknown>).event;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

const SAFE_HEADER_NAMES = ["content-type", "user-agent", "x-forwarded-for"];

// Nunca captura Authorization/Cookie — o segredo já está na URL, não em header.
export function extractRelevantHeaders(headers: Headers): Record<string, string> {
  const captured: Record<string, string> = {};
  for (const name of SAFE_HEADER_NAMES) {
    const value = headers.get(name);
    if (value) captured[name] = value;
  }
  for (const [key, value] of headers.entries()) {
    if (key.toLowerCase().startsWith("x-hubla")) captured[key.toLowerCase()] = value;
  }
  return captured;
}

export async function captureHublaEvent(input: {
  payload: unknown;
  headers: Record<string, string>;
  providerEventId: string | null;
  eventType: string | null;
  productId: string | null;
  productName: string | null;
  customerName: string | null;
  customerPhone: string | null;
}) {
  const admin = supabaseAdmin();
  const { data, error } = await admin.from("official_events").insert({
    provider: "hubla",
    provider_event_id: input.providerEventId,
    event_type: input.eventType,
    product_id: input.productId,
    product_name: input.productName,
    customer_name: input.customerName,
    customer_phone: input.customerPhone,
    payload: input.payload,
    headers: input.headers,
    status: "received"
  }).select("id").single();
  if (error) {
    if (/duplicate|unique/i.test(error.message)) return { duplicate: true as const, id: null };
    throw error;
  }
  return { duplicate: false as const, id: data.id as string };
}

// Captura de clique de botão vindo do webhook da Meta (provider "meta") — mesma tabela
// official_events, mesma garantia de idempotência por (provider, provider_event_id).
export async function captureMetaButtonClick(input: { payload: unknown; providerEventId: string; buttonPayload: string; fromPhone: string }) {
  const admin = supabaseAdmin();
  const { data, error } = await admin.from("official_events").insert({
    provider: "meta",
    provider_event_id: input.providerEventId,
    event_type: input.buttonPayload,
    customer_phone: input.fromPhone,
    payload: input.payload,
    status: "received"
  }).select("id").single();
  if (error) {
    if (/duplicate|unique/i.test(error.message)) return { duplicate: true as const, id: null };
    throw error;
  }
  return { duplicate: false as const, id: data.id as string };
}

export async function listRecentMetaEvents(limit = 30) {
  const admin = supabaseAdmin();
  const { data, error } = await admin.from("official_events")
    .select("*, official_quick_reply_actions(response_type, button_label), official_messages(meta_message_id, status, error)")
    .eq("provider", "meta").order("created_at", { ascending: false }).limit(limit);
  if (error) throw error;
  return data || [];
}

export async function listRecentHublaEvents(limit = 30) {
  const admin = supabaseAdmin();
  const { data, error } = await admin.from("official_events").select("*").eq("provider", "hubla").order("created_at", { ascending: false }).limit(limit);
  if (error) throw error;
  return data || [];
}

export async function getHublaEventById(id: string) {
  const admin = supabaseAdmin();
  const { data, error } = await admin.from("official_events").select("id,status,payload").eq("id", id).eq("provider", "hubla").maybeSingle();
  if (error) throw error;
  return data;
}

// Genérico — usado tanto por eventos da Hubla quanto por cliques de botão vindos da Meta.
export async function getEventById(id: string) {
  const admin = supabaseAdmin();
  const { data, error } = await admin.from("official_events").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return data;
}

// Busca best-effort de contexto (nome/produto) por telefone, para personalizar respostas a
// clique de botão — não é CRM/lista de contatos, só olha os eventos de compra já recebidos.
export async function findRecentHublaContextByPhone(normalizedPhone: string) {
  const admin = supabaseAdmin();
  const { data, error } = await admin.from("official_events")
    .select("customer_name,customer_phone,product_name")
    .eq("provider", "hubla").not("customer_phone", "is", null)
    .order("created_at", { ascending: false }).limit(200);
  if (error) throw error;
  for (const row of data || []) {
    try {
      if (normalizeBrazilianPhone(row.customer_phone as string) === normalizedPhone) return row;
    } catch {
      continue;
    }
  }
  return null;
}

export type OfficialEventStatus = "received" | "ignored" | "processing" | "processed" | "failed" | "duplicate";

export async function markEventStatus(
  id: string,
  status: OfficialEventStatus,
  error: string | null,
  matched: { automationId?: string | null; quickReplyActionId?: string | null } = {}
) {
  const admin = supabaseAdmin();
  const { error: dbError } = await admin.from("official_events").update({
    status,
    error,
    ...(matched.automationId !== undefined ? { automation_id: matched.automationId } : {}),
    ...(matched.quickReplyActionId !== undefined ? { quick_reply_action_id: matched.quickReplyActionId } : {}),
    processed_at: new Date().toISOString()
  }).eq("id", id);
  if (dbError) throw dbError;
}
