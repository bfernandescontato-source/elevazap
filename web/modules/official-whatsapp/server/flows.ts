import { supabaseAdmin } from "@/lib/supabase";
import { randomUUID } from "node:crypto";
import { createQuickReplyAction, type ButtonConfig, type QuickReplyAction } from "./quick-reply-actions";
import type { VariableMapping } from "./variable-resolver";

export type OfficialFlow = {
  id: string;
  name: string;
  initial_template_name: string;
  initial_template_language: string;
  variable_mapping: VariableMapping;
  quick_reply_action_id: string;
  quick_reply_payload: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
};

export type OfficialFlowWithAction = OfficialFlow & { official_quick_reply_actions: QuickReplyAction };

export type FlowInput = {
  name: string;
  initialTemplateName: string;
  initialTemplateLanguage: string;
  variableMapping: VariableMapping;
  quickReplyPayload: string;
  quickReplyLabel: string | null;
  followupResponseType: QuickReplyAction["response_type"];
  followupResponseText: string | null;
  followupMediaBucket: string | null;
  followupMediaPath: string | null;
  followupMimeType: string | null;
  followupFileName: string | null;
  followupCaption: string | null;
  followupButtonConfig: ButtonConfig | null;
};

export async function listFlows(): Promise<OfficialFlowWithAction[]> {
  const admin = supabaseAdmin();
  const { data, error } = await admin.from("official_flows").select("*, official_quick_reply_actions(*)").order("created_at", { ascending: false });
  if (error) throw error;
  return (data || []) as OfficialFlowWithAction[];
}

export async function getFlow(id: string): Promise<OfficialFlowWithAction | null> {
  const admin = supabaseAdmin();
  const { data, error } = await admin.from("official_flows").select("*, official_quick_reply_actions(*)").eq("id", id).maybeSingle();
  if (error) throw error;
  return data as OfficialFlowWithAction | null;
}

async function upsertFollowupAction(input: FlowInput) {
  return createQuickReplyAction({
    payload: `flow-private:${randomUUID()}`,
    buttonLabel: input.quickReplyLabel,
    responseType: input.followupResponseType,
    responseText: input.followupResponseText,
    mediaBucket: input.followupMediaBucket,
    mediaPath: input.followupMediaPath,
    mimeType: input.followupMimeType,
    fileName: input.followupFileName,
    caption: input.followupCaption,
    buttonConfig: input.followupButtonConfig,
    active: true
  });
}

async function assertFlowHasNoPendingBroadcasts(id: string) {
  const { count, error } = await supabaseAdmin().from("official_broadcasts")
    .select("id", { count: "exact", head: true })
    .eq("flow_id", id)
    .in("status", ["scheduled", "processing", "paused"]);
  if (error) throw error;
  if (count) throw new Error("Este fluxo está vinculado a um disparo agendado ou em andamento. Cancele ou conclua o disparo antes de alterar o fluxo.");
}

// Each flow revision gets a private action; never overwrite a legacy/global response
// merely because the visible button text matches another product or flow.
export async function createFlow(input: FlowInput): Promise<OfficialFlowWithAction> {
  const action = await upsertFollowupAction(input);
  const admin = supabaseAdmin();
  const { data, error } = await admin.from("official_flows").insert({
    name: input.name,
    initial_template_name: input.initialTemplateName,
    initial_template_language: input.initialTemplateLanguage,
    variable_mapping: input.variableMapping,
    quick_reply_action_id: action.id,
    quick_reply_payload: input.quickReplyPayload,
    active: true
  }).select("*, official_quick_reply_actions(*)").single();
  if (error) throw error;
  return data as OfficialFlowWithAction;
}

// Edita um fluxo existente: atualiza (ou troca, se o payload mudou) a ação de resposta
// vinculada e os campos do fluxo. Não mexe em flow_runs já criados.
export async function updateFlow(id: string, input: FlowInput): Promise<OfficialFlowWithAction> {
  await assertFlowHasNoPendingBroadcasts(id);
  const action = await upsertFollowupAction(input);
  const admin = supabaseAdmin();
  const { data, error } = await admin.from("official_flows").update({
    name: input.name,
    initial_template_name: input.initialTemplateName,
    initial_template_language: input.initialTemplateLanguage,
    variable_mapping: input.variableMapping,
    quick_reply_action_id: action.id,
    quick_reply_payload: input.quickReplyPayload,
    updated_at: new Date().toISOString()
  }).eq("id", id).select("*, official_quick_reply_actions(*)").single();
  if (error) throw error;
  return data as OfficialFlowWithAction;
}

// Validação compartilhada entre criar e editar — mesmo formulário, mesmas regras.
export function parseFlowInput(body: Record<string, any> | null): FlowInput | { error: string } {
  const name = String(body?.name || "").trim();
  const initialTemplateName = String(body?.initialTemplateName || "").trim();
  const initialTemplateLanguage = String(body?.initialTemplateLanguage || "").trim();
  const quickReplyPayload = String(body?.quickReplyPayload || "").trim();
  const followupResponseType = String(body?.followupResponseType || "");
  if (!name || !initialTemplateName || !initialTemplateLanguage || !quickReplyPayload || !["text", "image", "video", "audio", "document"].includes(followupResponseType)) {
    return { error: "Nome, template inicial, payload do Quick Reply e tipo de resposta são obrigatórios." };
  }
  if (followupResponseType === "text" && !String(body?.followupResponseText || "").trim()) {
    return { error: "Mensagem de resposta é obrigatória." };
  }
  if (followupResponseType !== "text" && (!body?.followupMediaBucket || !body?.followupMediaPath)) {
    return { error: "Envie o arquivo de mídia da resposta." };
  }
  let buttonConfig: ButtonConfig | null = null;
  if (body?.followupButtonConfig && followupResponseType !== "audio") {
    const bc = body.followupButtonConfig;
    if (bc.type === "url" && bc.text && bc.url) buttonConfig = { type: "url", text: String(bc.text), url: String(bc.url) };
    else if (bc.type === "quick_reply" && bc.text && bc.payload) buttonConfig = { type: "quick_reply", text: String(bc.text), payload: String(bc.payload) };
  }
  return {
    name, initialTemplateName, initialTemplateLanguage,
    variableMapping: body?.variableMapping && typeof body.variableMapping === "object" ? body.variableMapping : {},
    quickReplyPayload,
    quickReplyLabel: body?.quickReplyLabel || null,
    followupResponseType: followupResponseType as QuickReplyAction["response_type"],
    followupResponseText: body?.followupResponseText || null,
    followupMediaBucket: body?.followupMediaBucket || null,
    followupMediaPath: body?.followupMediaPath || null,
    followupMimeType: body?.followupMimeType || null,
    followupFileName: body?.followupFileName || null,
    followupCaption: body?.followupCaption || null,
    followupButtonConfig: buttonConfig
  };
}

export async function updateFlowActive(id: string, active: boolean): Promise<OfficialFlow> {
  if (!active) await assertFlowHasNoPendingBroadcasts(id);
  const admin = supabaseAdmin();
  const { data, error } = await admin.from("official_flows").update({ active, updated_at: new Date().toISOString() }).eq("id", id).select("*").single();
  if (error) throw error;
  return data;
}
