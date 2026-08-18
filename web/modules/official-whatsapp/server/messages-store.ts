import { supabaseAdmin } from "@/lib/supabase";

export type OfficialMessageStatus = "queued" | "sent" | "accepted" | "delivered" | "read" | "failed";

export async function logMessageAttempt(input: {
  eventId: string | null;
  phone: string;
  templateName?: string | null;
  templateLanguage?: string | null;
  status: OfficialMessageStatus;
  error?: string;
  metaMessageId?: string | null;
  requestPayload?: unknown;
  responsePayload?: unknown;
}) {
  const admin = supabaseAdmin();
  const { error } = await admin.from("official_messages").insert({
    event_id: input.eventId,
    phone: input.phone,
    template_name: input.templateName ?? null,
    template_language: input.templateLanguage ?? null,
    status: input.status,
    error: input.error || null,
    meta_message_id: input.metaMessageId || null,
    request_payload: input.requestPayload ?? null,
    response_payload: input.responsePayload ?? null
  });
  if (error) throw error;
}

export async function listRecentMessages(limit = 30) {
  const admin = supabaseAdmin();
  const { data, error } = await admin.from("official_messages").select("*").order("created_at", { ascending: false }).limit(limit);
  if (error) throw error;
  return data || [];
}
