import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { decryptIntegrationSecret, encryptIntegrationSecret } from "@/lib/integration-crypto";
import { env } from "@/lib/env";
import { supabaseAdmin } from "@/lib/supabase";
import { OfficialWhatsAppError } from "./errors";

const digits = z.string().trim().regex(/^\d{5,30}$/, "Use apenas o ID numérico informado pela Meta.");
export const connectionIdSchema = z.union([z.literal("legacy"), z.string().uuid()]).nullish().transform((value) => value === "legacy" || !value ? null : value);
export const officialConnectionInputSchema = z.object({
  label: z.string().trim().min(2).max(80),
  appId: digits,
  businessPortfolioId: digits.optional().or(z.literal("")),
  wabaId: digits,
  phoneNumberId: digits,
  accessToken: z.string().trim().min(40).max(4096),
  appSecret: z.string().trim().min(16).max(512),
  graphVersion: z.string().trim().regex(/^v\d{2,3}\.\d+$/).default("v25.0")
});

export type OfficialConnectionConfig = {
  id: string | null;
  source: "legacy" | "database";
  label: string;
  token: string;
  appSecret: string;
  phoneNumberId: string;
  wabaId: string | null;
  version: string;
};

const visibleColumns = "id,label,app_id,business_portfolio_id,waba_id,phone_number_id,graph_version,status,is_default,display_phone_number,verified_name,waba_name,quality_rating,throughput_level,last_tested_at,last_error,webhook_verified_at,app_subscribed,created_at,updated_at";

function tokenHash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function constantTimeHexEqual(a: string, b: string) {
  const left = Buffer.from(a, "hex");
  const right = Buffer.from(b, "hex");
  return left.length === right.length && timingSafeEqual(left, right);
}

function legacyConfig(): OfficialConnectionConfig {
  const e = env();
  if (!e.META_ACCESS_TOKEN || !e.META_PHONE_NUMBER_ID || !e.META_GRAPH_VERSION || !e.META_APP_SECRET) {
    throw new OfficialWhatsAppError("META_NOT_CONFIGURED", "A conta oficial principal não está configurada.");
  }
  return {
    id: null,
    source: "legacy",
    label: "Conta principal",
    token: e.META_ACCESS_TOKEN,
    appSecret: e.META_APP_SECRET,
    phoneNumberId: e.META_PHONE_NUMBER_ID,
    wabaId: e.META_WABA_ID || null,
    version: e.META_GRAPH_VERSION
  };
}

export function legacyConnectionSummary() {
  const e = env();
  if (!e.META_ACCESS_TOKEN || !e.META_PHONE_NUMBER_ID || !e.META_GRAPH_VERSION) return null;
  return {
    id: "legacy",
    label: "Conta principal (atual)",
    phone_number_id: e.META_PHONE_NUMBER_ID,
    waba_id: e.META_WABA_ID || null,
    graph_version: e.META_GRAPH_VERSION,
    status: "connected",
    is_default: true,
    source: "legacy" as const,
    display_phone_number: null,
    verified_name: null,
    waba_name: null,
    quality_rating: null,
    throughput_level: null,
    last_tested_at: null,
    last_error: null
  };
}

export async function resolveOfficialConnection(connectionId?: string | null, forSending = false): Promise<OfficialConnectionConfig> {
  connectionId = connectionIdSchema.parse(connectionId);
  if (!connectionId || connectionId === "legacy") return legacyConfig();
  const { data, error } = await supabaseAdmin().from("official_connections")
    .select("id,label,waba_id,phone_number_id,graph_version,status,encrypted_access_token,encrypted_app_secret,webhook_verified_at,app_subscribed")
    .eq("id", connectionId).maybeSingle();
  if (error) throw error;
  if (!data || data.status === "disabled") throw new OfficialWhatsAppError("META_NOT_CONFIGURED", "Conta oficial não encontrada ou desativada.");
  if (forSending && (data.status !== "connected" || !data.webhook_verified_at || !data.app_subscribed)) throw new OfficialWhatsAppError("META_NOT_CONFIGURED", "Finalize e teste a conexão, o webhook e o vínculo do aplicativo antes de enviar por esta conta.");
  return {
    id: data.id,
    source: "database",
    label: data.label,
    token: decryptIntegrationSecret(data.encrypted_access_token),
    appSecret: decryptIntegrationSecret(data.encrypted_app_secret),
    phoneNumberId: data.phone_number_id,
    wabaId: data.waba_id,
    version: data.graph_version
  };
}

async function rawGraphRequest(config: Pick<OfficialConnectionConfig, "token" | "version">, path: string) {
  const response = await fetch(`https://graph.facebook.com/${config.version}${path}`, {
    headers: { authorization: `Bearer ${config.token}` },
    cache: "no-store",
    signal: AbortSignal.timeout(15_000)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const metaError = data?.error;
    const code = response.status === 401 || metaError?.code === 190 ? "META_AUTH_ERROR" : "META_SEND_ERROR";
    const safeMessage = typeof metaError?.message === "string" ? metaError.message.split(config.token).join("[credencial protegida]").replace(/EA[A-Za-z0-9_-]{30,}/g, "[token protegido]") : "A Meta recusou a conexão.";
    throw new OfficialWhatsAppError(code, safeMessage, {
      httpStatus: response.status,
      code: metaError?.code,
      subcode: metaError?.error_subcode,
      type: metaError?.type,
      message: safeMessage,
      errorData: metaError?.error_data,
      fbtraceId: metaError?.fbtrace_id
    });
  }
  return data;
}

async function inspectCredentials(input: z.infer<typeof officialConnectionInputSchema>) {
  const config = { token: input.accessToken, version: input.graphVersion };
  // Authenticate the app secret as well as the access token. Never accept a token
  // from one app with the webhook secret from another.
  const debug = await rawGraphRequest({ token: `${input.appId}|${input.appSecret}`, version: input.graphVersion }, `/debug_token?input_token=${encodeURIComponent(input.accessToken)}`);
  const token = debug?.data;
  if (!token?.is_valid || String(token.app_id) !== input.appId) throw new Error("O token não pertence ao aplicativo informado ou expirou.");
  for (const permission of ["whatsapp_business_management", "whatsapp_business_messaging"]) {
    if (!token.scopes?.includes(permission)) throw new Error(`O token precisa da permissão ${permission}.`);
  }
  const [phone, waba, phones] = await Promise.all([
    rawGraphRequest(config, `/${input.phoneNumberId}?fields=id,verified_name,display_phone_number,quality_rating,throughput`),
    rawGraphRequest(config, `/${input.wabaId}?fields=id,name`),
    rawGraphRequest(config, `/${input.wabaId}/phone_numbers?fields=id&limit=100`)
  ]);
  if (!Array.isArray(phones?.data) || !phones.data.some((item: { id?: unknown }) => item.id === input.phoneNumberId)) {
    throw new OfficialWhatsAppError("META_SEND_ERROR", "O Phone Number ID não pertence à WABA informada.");
  }
  const throughput = phone?.throughput;
  const subscribed = await rawGraphRequest(config, `/${input.wabaId}/subscribed_apps`);
  return {
    displayPhoneNumber: phone?.display_phone_number || null,
    verifiedName: phone?.verified_name || null,
    qualityRating: phone?.quality_rating || null,
    throughputLevel: typeof throughput?.level === "string" ? throughput.level : typeof throughput === "string" ? throughput : null,
    wabaName: waba?.name || null,
    appSubscribed: Array.isArray(subscribed?.data) && subscribed.data.some((app: any) => String(app.whatsapp_business_api_data?.id || app.id) === input.appId)
  };
}

export async function listOfficialConnections() {
  const { data, error } = await supabaseAdmin().from("official_connections").select(visibleColumns).order("created_at", { ascending: true });
  if (error) throw error;
  const legacy = legacyConnectionSummary();
  return [...(legacy ? [legacy] : []), ...(data || []).map((row) => ({ ...row, source: "database" as const }))];
}

export async function createOfficialConnection(rawInput: unknown, createdBy: string) {
  const input = officialConnectionInputSchema.parse(rawInput);
  if (input.phoneNumberId === env().META_PHONE_NUMBER_ID) throw new Error("Este número já é a conta principal atual.");
  const inspected = await inspectCredentials(input);
  const verifyToken = randomBytes(32).toString("hex");
  const now = new Date().toISOString();
  const { data, error } = await supabaseAdmin().from("official_connections").insert({
    label: input.label,
    app_id: input.appId || null,
    business_portfolio_id: input.businessPortfolioId || null,
    waba_id: input.wabaId,
    phone_number_id: input.phoneNumberId,
    encrypted_access_token: encryptIntegrationSecret(input.accessToken),
    encrypted_app_secret: encryptIntegrationSecret(input.appSecret),
    webhook_verify_token_hash: tokenHash(verifyToken),
    graph_version: input.graphVersion,
    status: "connected",
    is_default: false,
    display_phone_number: inspected.displayPhoneNumber,
    verified_name: inspected.verifiedName,
    waba_name: inspected.wabaName,
    quality_rating: inspected.qualityRating,
    throughput_level: inspected.throughputLevel,
    last_tested_at: now,
    app_subscribed: inspected.appSubscribed,
    last_error: null,
    created_by: createdBy,
    updated_at: now
  }).select(visibleColumns).single();
  if (error) {
    if (error.code === "23505") throw new Error("Este Phone Number ID já está conectado.");
    throw error;
  }
  return { connection: { ...data, source: "database" as const }, verifyToken };
}

export async function testStoredOfficialConnection(id: string) {
  const config = await resolveOfficialConnection(id);
  const { data: stored, error: readError } = await supabaseAdmin().from("official_connections").select("app_id").eq("id", id).single();
  if (readError) throw readError;
  const input = {
    label: config.label,
    appId: stored.app_id,
    businessPortfolioId: "",
    wabaId: config.wabaId || "",
    phoneNumberId: config.phoneNumberId,
    accessToken: config.token,
    appSecret: config.appSecret,
    graphVersion: config.version
  };
  try {
    const inspected = await inspectCredentials(officialConnectionInputSchema.parse(input));
    const now = new Date().toISOString();
    const { error } = await supabaseAdmin().from("official_connections").update({
      status: "connected",
      display_phone_number: inspected.displayPhoneNumber,
      verified_name: inspected.verifiedName,
      waba_name: inspected.wabaName,
      quality_rating: inspected.qualityRating,
      throughput_level: inspected.throughputLevel,
      last_tested_at: now,
      app_subscribed: inspected.appSubscribed,
      last_error: null,
      updated_at: now
    }).eq("id", id);
    if (error) throw error;
    return inspected;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha ao testar conexão.";
    await supabaseAdmin().from("official_connections").update({ status: "error", last_tested_at: new Date().toISOString(), last_error: message.slice(0, 500), updated_at: new Date().toISOString() }).eq("id", id);
    throw error;
  }
}

export async function updateOfficialConnection(id: string, input: { label?: string; status?: "connected" | "disabled" }) {
  const admin = supabaseAdmin();
  if (input.status === "disabled") {
    const { count, error } = await admin.from("official_broadcasts").select("id", { count: "exact", head: true }).eq("connection_id", id).eq("status", "processing");
    if (error) throw error;
    if (count) throw new Error("Pause os disparos em andamento desta conta antes de desativá-la.");
  }
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (input.label !== undefined) patch.label = z.string().trim().min(2).max(80).parse(input.label);
  if (input.status !== undefined) patch.status = input.status;
  const { data, error } = await admin.from("official_connections").update(patch).eq("id", id).select(visibleColumns).single();
  if (error) throw error;
  return data;
}

export async function listWebhookCredentials() {
  const credentials: Array<{ id: string | null; phoneNumberId: string; wabaId: string | null; appSecret: string }> = [];
  try { const legacy = legacyConfig(); credentials.push(legacy); } catch {}
  // Disabled senders still receive delivery receipts for past messages.
  const { data, error } = await supabaseAdmin().from("official_connections").select("id,phone_number_id,waba_id,encrypted_app_secret");
  if (error) throw error;
  for (const row of data || []) credentials.push({ id: row.id, phoneNumberId: row.phone_number_id, wabaId: row.waba_id, appSecret: decryptIntegrationSecret(row.encrypted_app_secret) });
  return credentials;
}

export async function webhookVerifyTokenMatches(value: string) {
  const configured = env().META_WEBHOOK_VERIFY_TOKEN;
  if (configured && constantTimeHexEqual(tokenHash(value), tokenHash(configured))) return true;
  const hash = tokenHash(value);
  const { data, error } = await supabaseAdmin().from("official_connections").select("id,webhook_verify_token_hash").neq("status", "disabled");
  if (error) throw error;
  const match = (data || []).find((row) => constantTimeHexEqual(hash, row.webhook_verify_token_hash));
  if (!match) return false;
  const { error: updateError } = await supabaseAdmin().from("official_connections").update({ webhook_verified_at: new Date().toISOString() }).eq("id", match.id);
  if (updateError) throw updateError;
  return true;
}

export async function rotateConnectionWebhookToken(id: string) {
  const verifyToken = randomBytes(32).toString("hex");
  const { error } = await supabaseAdmin().from("official_connections").update({ webhook_verify_token_hash: tokenHash(verifyToken), webhook_verified_at: null, updated_at: new Date().toISOString() }).eq("id", id).select("id").single();
  if (error) throw error;
  return verifyToken;
}

export async function replaceOfficialConnectionCredentials(id: string, rawInput: unknown) {
  const input = officialConnectionInputSchema.parse(rawInput);
  const { data: current, error } = await supabaseAdmin().from("official_connections").select("app_id,waba_id,phone_number_id").eq("id", id).single();
  if (error) throw error;
  if (current.app_id !== input.appId || current.waba_id !== input.wabaId || current.phone_number_id !== input.phoneNumberId) throw new Error("Para trocar aplicativo, WABA ou número, cadastre outra conta. A troca de credenciais preserva a identidade atual.");
  const inspected = await inspectCredentials(input);
  const { error: saveError } = await supabaseAdmin().from("official_connections").update({ label: input.label, encrypted_access_token: encryptIntegrationSecret(input.accessToken), encrypted_app_secret: encryptIntegrationSecret(input.appSecret), graph_version: input.graphVersion, status: "connected", last_error: null, last_tested_at: new Date().toISOString(), app_subscribed: inspected.appSubscribed, updated_at: new Date().toISOString() }).eq("id", id);
  if (saveError) throw saveError;
}
