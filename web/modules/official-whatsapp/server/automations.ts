import { supabaseAdmin } from "@/lib/supabase";
import type { VariableMapping } from "./variable-resolver";

export type OfficialAutomation = {
  id: string;
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
  return rows.find((row) => row.product_id === productId) || rows.find((row) => !row.product_id) || null;
}
