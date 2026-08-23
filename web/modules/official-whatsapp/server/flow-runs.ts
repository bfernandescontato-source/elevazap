import { supabaseAdmin } from "@/lib/supabase";
import type { EventContext } from "./variable-resolver";

export type FlowRunStatus = "sent" | "clicked" | "completed" | "failed";
export type FlowRun = {
  id: string;
  flow_id: string;
  source: string;
  source_reference: string | null;
  phone: string;
  context: EventContext;
  initial_meta_message_id: string | null;
  status: FlowRunStatus;
  created_at: string;
  clicked_at: string | null;
  completed_at: string | null;
  final_meta_message_id: string | null;
  final_destination_url: string | null;
  final_link_clicked_at: string | null;
  joined_group_at: string | null;
  joined_group_jid: string | null;
};

export async function createFlowRun(input: {
  flowId: string;
  source: string;
  sourceReference: string | null;
  phone: string;
  context: EventContext;
  initialMetaMessageId: string | null;
}): Promise<FlowRun> {
  const admin = supabaseAdmin();
  const { data, error } = await admin.from("official_flow_runs").insert({
    flow_id: input.flowId,
    source: input.source,
    source_reference: input.sourceReference,
    phone: input.phone,
    context: input.context,
    initial_meta_message_id: input.initialMetaMessageId,
    status: "sent"
  }).select("*").single();
  if (error) throw error;
  return data;
}

// Correlação confiável: o clique traz context.id = wamid da mensagem original respondida.
export async function findFlowRunByMessageId(messageId: string): Promise<FlowRun | null> {
  const admin = supabaseAdmin();
  const { data, error } = await admin.from("official_flow_runs").select("*").eq("initial_meta_message_id", messageId).maybeSingle();
  if (error) throw error;
  return data;
}

export async function getFlowRun(id: string): Promise<FlowRun | null> {
  const admin = supabaseAdmin();
  const { data, error } = await admin.from("official_flow_runs").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return data;
}

export async function setFlowRunFinalDestination(id: string, destinationUrl: string) {
  const admin = supabaseAdmin();
  const { error } = await admin.from("official_flow_runs").update({ final_destination_url: destinationUrl }).eq("id", id);
  if (error) throw error;
}

export async function setFlowRunFinalMessageId(id: string, messageId: string | null) {
  if (!messageId) return;
  const admin = supabaseAdmin();
  const { error } = await admin.from("official_flow_runs").update({ final_meta_message_id: messageId }).eq("id", id);
  if (error) throw error;
}

export async function markFlowRunStatus(id: string, status: FlowRunStatus) {
  const admin = supabaseAdmin();
  const now = new Date().toISOString();
  const extra = status === "clicked" ? { clicked_at: now } : status === "completed" || status === "failed" ? { completed_at: now } : {};
  const { error } = await admin.from("official_flow_runs").update({ status, ...extra }).eq("id", id);
  if (error) throw error;
}

// Todo flow_run só é criado depois de um envio inicial aceito (startFlow só chama
// createFlowRun após sendWhatsAppTemplate ter sucesso) — então "existe flow_run" já
// significa "já recebeu esse fluxo", sem precisar checar status.
export async function findPhonesWithPriorRun(flowId: string, phones: string[]): Promise<Set<string>> {
  if (!phones.length) return new Set();
  const admin = supabaseAdmin();
  const { data, error } = await admin.from("official_flow_runs").select("phone").eq("flow_id", flowId).in("phone", phones);
  if (error) throw error;
  return new Set((data || []).map((row) => row.phone as string));
}

export async function listRecentFlowRuns(limit = 30) {
  const admin = supabaseAdmin();
  const { data, error } = await admin.from("official_flow_runs").select("*, official_flows(name)").order("created_at", { ascending: false }).limit(limit);
  if (error) throw error;
  return data || [];
}
