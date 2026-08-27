import { createHmac, timingSafeEqual } from "node:crypto";
import { appUrl, env } from "@/lib/env";
import { supabaseAdmin } from "@/lib/supabase";
import { getFlowRun } from "./flow-runs";
import { recordCtaClick } from "./analytics-attribution";

const FLOW_RUN_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function signature(flowRunId: string, secret: string) {
  return createHmac("sha256", secret).update(`official-final-link:${flowRunId}`).digest("base64url");
}

export function createTrackedLinkToken(flowRunId: string, secret = env().AUTH_SECRET) {
  if (!FLOW_RUN_ID.test(flowRunId)) throw new Error("Flow run inválido para rastreamento.");
  return `${flowRunId}.${signature(flowRunId, secret)}`;
}

export function verifyTrackedLinkToken(token: string, secret = env().AUTH_SECRET) {
  const separator = token.lastIndexOf(".");
  if (separator <= 0) return null;
  const flowRunId = token.slice(0, separator);
  const supplied = token.slice(separator + 1);
  if (!FLOW_RUN_ID.test(flowRunId) || !supplied) return null;
  const expected = signature(flowRunId, secret);
  const a = Buffer.from(expected);
  const b = Buffer.from(supplied);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return flowRunId;
}

export function buildTrackedFinalLink(flowRunId: string) {
  return `${appUrl().replace(/\/$/, "")}/o/${createTrackedLinkToken(flowRunId)}`;
}

function safeDestination(value: string | null) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export async function getTrackedFinalDestination(flowRunId: string) {
  if (!FLOW_RUN_ID.test(flowRunId)) return null;
  const run = await getFlowRun(flowRunId);
  return safeDestination(run?.final_destination_url || null);
}

export async function resolveAndRecordTrackedFinalLink(token: string) {
  const flowRunId = verifyTrackedLinkToken(token);
  if (!flowRunId) return null;
  const run = await getFlowRun(flowRunId);
  const destination = safeDestination(run?.final_destination_url || null);
  if (!run || !destination) return null;

  const admin = supabaseAdmin();
  const clickedAt = new Date().toISOString();
  const { error: clickError } = await admin.from("official_final_link_clicks").insert({
    flow_run_id: run.id,
    destination_url: destination,
    clicked_at: clickedAt
  });
  if (clickError) throw clickError;

  const [{ data: message }, { data: step }] = await Promise.all([
    admin.from("official_messages").select("id,flow_id,step_id,broadcast_id,template_id").eq("meta_message_id", run.final_meta_message_id).maybeSingle(),
    admin.from("official_flow_steps").select("id").eq("flow_id", run.flow_id).eq("step_key", "follow_up").maybeSingle()
  ]);
  const { data: cta } = step ? await admin.from("official_flow_ctas").select("id").eq("flow_step_id", step.id).eq("cta_key", "destination").maybeSingle() : { data: null };
  await recordCtaClick({ flowRunId: run.id, flowId: message?.flow_id || run.flow_id, stepId: message?.step_id || step?.id || null, messageId: message?.id || null, templateId: message?.template_id || null, ctaId: cta?.id || null, broadcastId: message?.broadcast_id || null, phone: run.phone, destinationUrl: destination });

  // Mantém a primeira data no flow_run; todos os cliques continuam no histórico acima.
  const { error: runError } = await admin.from("official_flow_runs")
    .update({ final_link_clicked_at: clickedAt })
    .eq("id", run.id)
    .is("final_link_clicked_at", null);
  if (runError) throw runError;
  return destination;
}
