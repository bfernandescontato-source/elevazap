import { randomBytes, createHash, timingSafeEqual } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase";
import { connectionIdSchema, resolveOfficialConnection } from "./official-connections";

export type ExternalSource = {
  id: string;
  connection_id: string | null;
  name: string;
  source_key: string;
  flow_id: string;
  secret_hash: string;
  fixed_content_name: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
};

export type ExternalSourceWithFlow = ExternalSource & { official_flows: { name: string } | null };

// Mesmo padrão já usado pra token de extensão (mercado-livre-extension.ts): segredo aleatório
// mostrado uma única vez na criação, só o hash SHA-256 fica salvo — comparação em runtime é
// sempre hash-a-hash com timingSafeEqual, o valor em texto puro nunca é persistido.
export function generateExternalSecret() {
  return randomBytes(32).toString("base64url");
}

export function hashExternalSecret(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function externalSecretMatches(provided: string, expectedHash: string) {
  const providedHash = Buffer.from(hashExternalSecret(provided), "hex");
  const expected = Buffer.from(expectedHash, "hex");
  if (providedHash.length !== expected.length) return false;
  return timingSafeEqual(providedHash, expected);
}

export async function listExternalSources(): Promise<(ExternalSourceWithFlow & {
  receivedToday: number; acceptedToday: number; duplicateToday: number; failedToday: number; lastEventAt: string | null;
})[]> {
  const admin = supabaseAdmin();
  const { data: sources, error } = await admin.from("official_external_sources").select("*, official_flows(name)").order("created_at", { ascending: false });
  if (error) throw error;
  if (!sources?.length) return [];

  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const { data: todayLeads, error: leadsError } = await admin.from("official_external_leads")
    .select("source_id,status,created_at").gte("created_at", startOfDay.toISOString());
  if (leadsError) throw leadsError;

  const statsBySource = new Map<string, { receivedToday: number; acceptedToday: number; duplicateToday: number; failedToday: number; lastEventAt: string | null }>();
  for (const lead of todayLeads || []) {
    const current = statsBySource.get(lead.source_id) || { receivedToday: 0, acceptedToday: 0, duplicateToday: 0, failedToday: 0, lastEventAt: null };
    current.receivedToday += 1;
    if (lead.status === "accepted") current.acceptedToday += 1;
    if (lead.status === "duplicate") current.duplicateToday += 1;
    if (lead.status === "failed") current.failedToday += 1;
    if (!current.lastEventAt || lead.created_at > current.lastEventAt) current.lastEventAt = lead.created_at;
    statsBySource.set(lead.source_id, current);
  }

  return (sources as ExternalSourceWithFlow[]).map((source) => ({
    ...source,
    ...(statsBySource.get(source.id) || { receivedToday: 0, acceptedToday: 0, duplicateToday: 0, failedToday: 0, lastEventAt: null })
  }));
}

export async function getExternalSource(id: string): Promise<ExternalSourceWithFlow | null> {
  const admin = supabaseAdmin();
  const { data, error } = await admin.from("official_external_sources").select("*, official_flows(name)").eq("id", id).maybeSingle();
  if (error) throw error;
  return data as ExternalSourceWithFlow | null;
}

// Usada pelo endpoint público — busca só pelas colunas necessárias pra autenticar e resolver o
// fluxo. Não expõe isso pro admin (essa função não faz join com official_flows.name).
export async function findExternalSourceByKey(sourceKey: string): Promise<ExternalSource | null> {
  const admin = supabaseAdmin();
  const { data, error } = await admin.from("official_external_sources").select("*").eq("source_key", sourceKey).maybeSingle();
  if (error) throw error;
  return data;
}

// Retorna o segredo em texto puro só desta vez — chamado só na criação. Nunca é lido de volta.
export async function createExternalSource(input: { name: string; sourceKey: string; flowId: string; fixedContentName: string | null; connectionId?: string | null }) {
  const admin = supabaseAdmin();
  const connectionId = connectionIdSchema.parse(input.connectionId);
  await resolveOfficialConnection(connectionId);
  const secret = generateExternalSecret();
  const { data, error } = await admin.from("official_external_sources").insert({
    name: input.name,
    source_key: input.sourceKey,
    flow_id: input.flowId,
    connection_id: connectionId,
    secret_hash: hashExternalSecret(secret),
    fixed_content_name: input.fixedContentName,
    active: true
  }).select("*, official_flows(name)").single();
  if (error) throw error;
  return { source: data as ExternalSourceWithFlow, secret };
}

const SOURCE_KEY_PATTERN = /^[a-z0-9][a-z0-9_-]{1,63}$/;

// Validação compartilhada entre criar e editar. source_key vem de fora (campo "origem" do
// request público), então o charset é restrito de propósito — é usado como chave de lookup.
export function parseExternalSourceInput(body: Record<string, any> | null): { name: string; sourceKey: string; flowId: string; fixedContentName: string | null } | { error: string } {
  const name = String(body?.name || "").trim();
  const sourceKey = String(body?.sourceKey || "").trim().toLowerCase();
  const flowId = String(body?.flowId || "").trim();
  if (!name || !flowId) return { error: "Nome e fluxo são obrigatórios." };
  if (!SOURCE_KEY_PATTERN.test(sourceKey)) return { error: "Source key deve ter só letras minúsculas, números, '-' ou '_' (2 a 64 caracteres)." };
  const fixedContentName = String(body?.fixedContentName || "").trim() || null;
  return { name, sourceKey, flowId, fixedContentName };
}

// sourceKey pode ser editada — quem chama o endpoint público com a key antiga (ex: Apps
// Script já implantado) simplesmente passa a receber SOURCE_NOT_FOUND até ser atualizado
// com a key nova, então trocar aqui é uma decisão consciente do admin, não travada por padrão.
export async function updateExternalSource(id: string, input: { name?: string; sourceKey?: string; flowId?: string; fixedContentName?: string | null; active?: boolean; connectionId?: string | null }) {
  const admin = supabaseAdmin();
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (input.connectionId !== undefined) {
    patch.connection_id = connectionIdSchema.parse(input.connectionId);
    await resolveOfficialConnection(patch.connection_id as string | null);
  }
  if (input.name !== undefined) patch.name = input.name;
  if (input.sourceKey !== undefined) patch.source_key = input.sourceKey;
  if (input.flowId !== undefined) patch.flow_id = input.flowId;
  if (input.fixedContentName !== undefined) patch.fixed_content_name = input.fixedContentName;
  if (input.active !== undefined) patch.active = input.active;
  const { data, error } = await admin.from("official_external_sources").update(patch).eq("id", id).select("*, official_flows(name)").single();
  if (error) throw error;
  return data as ExternalSourceWithFlow;
}
