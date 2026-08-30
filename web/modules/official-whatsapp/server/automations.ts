import { supabaseAdmin } from "@/lib/supabase";
import type { VariableMapping } from "./variable-resolver";
import { missingTemplateMappings } from "./variable-resolver";
import { findTemplate } from "./templates";
import { resolveOfficialConnection } from "./official-connections";
import type { AutomationInput, FollowupConfig, FollowupMode } from "../automation-config";

export type OfficialAutomation = {
  id: string;
  name: string;
  followup_mode: FollowupMode;
  followup_config: FollowupConfig | null;
  connection_id: string | null;
  event_type: string;
  product_id: string | null;
  product_name: string | null;
  template_name: string;
  template_language: string;
  variable_mapping: VariableMapping;
  active: boolean;
  created_at: string;
  updated_at: string;
};

export async function listAutomations(): Promise<OfficialAutomation[]> {
  const admin = supabaseAdmin();
  const { data, error } = await admin.from("official_automations").select("*").order("created_at", { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function createAutomation(input: {
  name: string;
  followupMode: FollowupMode;
  followupConfig: FollowupConfig | null;
  connectionId?: string | null;
  eventType: string;
  productId: string | null;
  productName: string | null;
  templateName: string;
  templateLanguage: string;
  variableMapping: VariableMapping;
  active: boolean;
}) {
  const admin = supabaseAdmin();
  const { data, error } = await admin.from("official_automations").insert({
    name: input.name,
    followup_mode: input.followupMode,
    followup_config: input.followupConfig,
    event_type: input.eventType,
    connection_id: input.connectionId || null,
    product_id: input.productId,
    product_name: input.productName,
    template_name: input.templateName,
    template_language: input.templateLanguage,
    variable_mapping: input.variableMapping,
    active: input.active
  }).select("*").single();
  if (error) throw error;
  return data as OfficialAutomation;
}

export async function updateAutomation(id: string, changes: {
  name?: string;
  product_name?: string | null;
  followup_mode?: FollowupMode;
  followup_config?: FollowupConfig | null;
  connection_id?: string | null;
  event_type?: string;
  product_id?: string | null;
  template_name?: string;
  template_language?: string;
  variable_mapping?: VariableMapping;
  active?: boolean;
}) {
  const admin = supabaseAdmin();
  const { data, error } = await admin.from("official_automations").update({ ...changes, updated_at: new Date().toISOString() }).eq("id", id).select("*").single();
  if (error) throw error;
  return data as OfficialAutomation;
}

// Prioriza automação com product_id exatamente igual ao evento; cai para uma automação
// "para todos os produtos" (product_id null) se não houver uma específica.
export async function findActiveAutomation(eventType: string | null, productId: string | null): Promise<OfficialAutomation | null> {
  if (!eventType) return null;
  const admin = supabaseAdmin();
  const { data, error } = await admin.from("official_automations").select("*").eq("event_type", eventType).eq("active", true);
  if (error) throw error;
  const rows = (data || []) as OfficialAutomation[];
  const exact = rows.filter((row) => row.product_id === productId);
  const matches = exact.length ? exact : rows.filter((row) => !row.product_id);
  if (matches.length > 1) throw new Error("Mais de uma automação ativa para o mesmo evento e produto. Revise a configuração.");
  return matches[0] || null;
}

export async function validateAutomationInput(input: AutomationInput) {
  await resolveOfficialConnection(input.connectionId);
  const template = await findTemplate(input.templateName, input.templateLanguage, input.connectionId);
  if (template.components.some((item) => item.type === "HEADER" && item.format && item.format !== "TEXT")) throw new Error("Este modelo exige mídia no cabeçalho. Escolha um modelo inicial com cabeçalho de texto.");
  const missing = missingTemplateMappings({ mapping: input.variableMapping, parameterFormat: template.parameterFormat, header: template.variables.header, body: template.variables.body, namedHeader: template.namedVariables.header, namedBody: template.namedVariables.body, dynamicButtons: template.dynamicUrlButtonIndexes });
  if (missing.length) throw new Error(`Preencha as variáveis do modelo: ${missing.join(", ")}.`);
  if (input.followupMode === "button") {
    const button = template.components.find((item) => item.type === "BUTTONS")?.buttons?.[Number(input.followupConfig!.triggerButtonIndex)];
    if (button?.type !== "QUICK_REPLY") throw new Error("Escolha um botão de resposta rápida existente no modelo inicial.");
  }
}

export function automationWriteError(error: unknown) {
  if (error && typeof error === "object" && "code" in error && error.code === "23505") return "Já existe uma automação ativa para este evento e produto. Edite a existente ou pause-a antes de ativar outra.";
  return error instanceof Error ? error.message : "Não foi possível salvar a automação.";
}
