import { supabaseAdmin } from "@/lib/supabase";
import type { MessageAttribution } from "./analytics-attribution";
import type { AutomationSnapshot } from "./automation-followup";

export type OfficialMessageStatus = "queued" | "sent" | "accepted" | "delivered" | "read" | "failed";

type MetaStatusValue = "sent" | "delivered" | "read" | "failed";
type MetaStatusEvent = {
  id?: unknown;
  status?: unknown;
  timestamp?: unknown;
  recipient_id?: unknown;
  conversation?: { id?: unknown; expiration_timestamp?: unknown; origin?: { type?: unknown } };
  pricing?: { billable?: unknown; pricing_model?: unknown; category?: unknown; type?: unknown };
  errors?: Array<{ code?: unknown; title?: unknown; message?: unknown; error_data?: { details?: unknown } }>;
};

const STATUS_RANK: Record<Exclude<OfficialMessageStatus, "failed">, number> = {
  queued: 0,
  accepted: 1,
  sent: 2,
  delivered: 3,
  read: 4
};

function isMetaStatus(value: unknown): value is MetaStatusValue {
  return value === "sent" || value === "delivered" || value === "read" || value === "failed";
}

function metaTimestamp(value: unknown) {
  const seconds = typeof value === "string" || typeof value === "number" ? Number(value) : Number.NaN;
  return Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1_000).toISOString() : new Date().toISOString();
}

function statusError(errors: MetaStatusEvent["errors"]) {
  if (!Array.isArray(errors) || !errors.length) return null;
  return errors.map((item) => [item.code, item.title || item.message, item.error_data?.details].filter(Boolean).join(": ")).filter(Boolean).join(" | ").slice(0, 500) || null;
}

function safeStatusPayload(status: MetaStatusEvent) {
  return {
    status: status.status,
    timestamp: status.timestamp,
    recipient_id: status.recipient_id,
    conversation: status.conversation ? {
      id: status.conversation.id,
      expiration_timestamp: status.conversation.expiration_timestamp,
      origin_type: status.conversation.origin?.type
    } : undefined,
    pricing: status.pricing ? {
      billable: status.pricing.billable,
      pricing_model: status.pricing.pricing_model,
      category: status.pricing.category,
      type: status.pricing.type
    } : undefined,
    errors: status.errors?.map((item) => ({
      code: item.code,
      title: item.title,
      message: item.message,
      details: item.error_data?.details
    }))
  };
}

export async function logMessageAttempt(input: {
  eventId: string | null;
  phone: string;
  templateName?: string | null;
  templateLanguage?: string | null;
  status: OfficialMessageStatus;
  flowRunId?: string | null;
  error?: string;
  metaMessageId?: string | null;
  requestPayload?: unknown;
  responsePayload?: unknown;
  attribution?: MessageAttribution;
  connectionId?: string | null;
  automationId?: string | null;
  automationSnapshot?: AutomationSnapshot | null;
}) {
  const admin = supabaseAdmin();
  const now = new Date().toISOString();
  const { data, error } = await admin.from("official_messages").insert({
    event_id: input.eventId,
    automation_id: input.automationId || null,
    automation_snapshot: input.automationSnapshot || null,
    automation_reply_state: input.automationSnapshot?.mode === "button" ? "waiting" : null,
    flow_run_id: input.flowRunId ?? null,
    phone: input.phone,
    template_name: input.templateName ?? null,
    template_language: input.templateLanguage ?? null,
    status: input.status,
    accepted_at: input.status === "accepted" ? now : null,
    failed_at: input.status === "failed" ? now : null,
    error: input.error || null,
    meta_message_id: input.metaMessageId || null,
    request_payload: input.requestPayload ?? null,
    response_payload: input.responsePayload ?? null
    ,source_type: input.attribution?.sourceType || "legacy",
    source_id: input.attribution?.sourceId || null, flow_id: input.attribution?.flowId || null,
    step_id: input.attribution?.stepId || null, message_key: input.attribution?.messageKey || null,
    template_id: input.attribution?.templateId || null, broadcast_id: input.attribution?.broadcastId || null,
    phone_number_id: input.attribution?.phoneNumberId || null,
    connection_id: input.connectionId === "legacy" ? null : input.connectionId || null
  }).select("id").single();
  if (error) throw error;
  return data;
}

// A Meta pode entregar webhooks fora de ordem. Nunca rebaixa "lida" para "entregue"
// nem transforma uma mensagem já entregue/lida em falha por um evento atrasado.
export async function applyMetaMessageStatus(rawStatus: unknown, connectionId?: string | null) {
  const status = (rawStatus || {}) as MetaStatusEvent;
  if (typeof status.id !== "string" || !isMetaStatus(status.status)) return { matched: false, ignored: true };

  const admin = supabaseAdmin();
  const { data: current, error: findError } = await admin
    .from("official_messages")
    .select("status,connection_id")
    .eq("meta_message_id", status.id)
    .limit(1)
    .maybeSingle();
  if (findError) throw findError;
  if (!current) return { matched: false, ignored: false };
  if (connectionId !== undefined && (current.connection_id || null) !== connectionId) return { matched: false, ignored: true };

  const currentStatus = current.status as OfficialMessageStatus;
  const ignoreFailure = status.status === "failed" && (currentStatus === "delivered" || currentStatus === "read");
  const ignoreRegression = status.status !== "failed" && currentStatus !== "failed"
    && STATUS_RANK[status.status] < STATUS_RANK[currentStatus];
  if (ignoreFailure || ignoreRegression || currentStatus === "failed") return { matched: true, ignored: true };

  const occurredAt = metaTimestamp(status.timestamp);
  const timestampField = status.status === "sent" ? "sent_at"
    : status.status === "delivered" ? "delivered_at"
    : status.status === "read" ? "read_at"
    : "failed_at";
  const values: Record<string, unknown> = {
    status: status.status,
    [timestampField]: occurredAt,
    status_payload: safeStatusPayload(status),
    updated_at: new Date().toISOString()
  };
  if (status.status === "failed") values.error = statusError(status.errors) || "Falha informada pela Meta.";

  const { error } = await admin.from("official_messages").update(values).eq("meta_message_id", status.id);
  if (error) throw error;

  const recipientValues: Record<string, unknown> = {
    status: status.status,
    status_payload: safeStatusPayload(status)
  };
  if (status.status === "delivered") recipientValues.delivered_at = occurredAt;
  if (status.status === "read") recipientValues.read_at = occurredAt;
  if (status.status === "failed") {
    recipientValues.failed_at = occurredAt;
    recipientValues.error = statusError(status.errors) || "Falha informada pela Meta.";
  }
  const { error: recipientError } = await admin.from("official_broadcast_recipients").update(recipientValues).eq("meta_message_id", status.id);
  if (recipientError) throw recipientError;
  return { matched: true, ignored: false };
}

export async function attachMessageToFlowRun(metaMessageId: string | null | undefined, flowRunId: string) {
  if (!metaMessageId) return;
  const admin = supabaseAdmin();
  const { error } = await admin.from("official_messages").update({ flow_run_id: flowRunId }).eq("meta_message_id", metaMessageId);
  if (error) throw error;
}

export async function listRecentMessages(limit = 30) {
  const admin = supabaseAdmin();
  const { data, error } = await admin.from("official_messages").select("*").order("created_at", { ascending: false }).limit(limit);
  if (error) throw error;
  return data || [];
}
