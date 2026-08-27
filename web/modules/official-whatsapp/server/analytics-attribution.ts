import { randomUUID } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase";

export type MessageAttribution = {
  sourceType: "automation" | "broadcast" | "manual" | "test" | "legacy";
  sourceId?: string | null;
  flowId?: string | null;
  stepId?: string | null;
  messageKey?: string | null;
  templateId?: string | null;
  broadcastId?: string | null;
  phoneNumberId?: string | null;
};

export async function getFlowStep(flowId: string, stepKey: string) {
  const admin = supabaseAdmin();
  const { data, error } = await admin.from("official_flow_steps").select("*").eq("flow_id", flowId).eq("step_key", stepKey).maybeSingle();
  if (error) throw error;
  return data;
}

export async function getFlowCta(flowId: string, stepKey: string, ctaKey: string) {
  const step = await getFlowStep(flowId, stepKey);
  if (!step) return null;
  const admin = supabaseAdmin();
  const { data, error } = await admin.from("official_flow_ctas").select("*").eq("flow_step_id", step.id).eq("cta_key", ctaKey).maybeSingle();
  if (error) throw error;
  return data;
}

export async function recordCtaClick(input: {
  clickId?: string; flowRunId?: string | null; flowId?: string | null; stepId?: string | null;
  messageId?: string | null; templateId?: string | null; ctaId?: string | null; broadcastId?: string | null;
  phone?: string | null; destinationUrl?: string | null;
}) {
  const admin = supabaseAdmin();
  const { error } = await admin.from("official_cta_clicks").insert({
    click_id: input.clickId || randomUUID(), flow_run_id: input.flowRunId || null, flow_id: input.flowId || null,
    step_id: input.stepId || null, message_id: input.messageId || null, template_id: input.templateId || null,
    cta_id: input.ctaId || null, broadcast_id: input.broadcastId || null, phone: input.phone || null,
    destination_url: input.destinationUrl || null
  });
  if (error && !/duplicate|unique/i.test(error.message)) throw error;
}
