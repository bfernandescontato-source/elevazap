import type { SupabaseClient } from "@supabase/supabase-js";
import { credentialFingerprint, encryptIntegrationSecret } from "@/lib/integration-crypto";
import { testShopeeCredentials } from "@/modules/offer-autopilot/server/shopee-client";
import { secretToken, tokenHash } from "@/modules/offer-autopilot/server/mercado-livre-extension";

export type IntegrationProvider = "shopee" | "mercado_livre" | "amazon";
type StoredProvider = Exclude<IntegrationProvider, "amazon">;

const visibleColumns = "provider,app_id,status,affiliate_tag,external_account_id,external_account_label,last_tested_at,last_error,auth_expires_at,updated_at";

export async function getIntegration(database: SupabaseClient, accountId: string, provider: IntegrationProvider) {
  if (provider === "amazon") return null;
  const { data, error } = await database.from("affiliate_integrations").select(visibleColumns).eq("account_id", accountId).eq("provider", provider).maybeSingle();
  if (error) throw error;
  if (provider === "mercado_livre" && data?.status === "connecting" && data.updated_at) {
    const connectionExpired = Date.now() - new Date(data.updated_at).getTime() > 5 * 60_000;
    if (connectionExpired) return { ...data, status: "error", last_error: "A extensão não concluiu a conexão. Confirme que ela está instalada e tente novamente." };
  }
  return data;
}

export const getShopeeIntegration = (database: SupabaseClient, accountId: string) => getIntegration(database, accountId, "shopee");
export const getMercadoLivreIntegration = (database: SupabaseClient, accountId: string) => getIntegration(database, accountId, "mercado_livre");
export const getAmazonIntegration = (_database: SupabaseClient, _accountId: string) => Promise.resolve(null);

export async function hasConnectedIntegration(database: SupabaseClient, accountId: string, provider: IntegrationProvider) {
  return (await getIntegration(database, accountId, provider))?.status === "connected";
}

export async function getShopeeIntegrationCredentials(database: SupabaseClient, accountId: string) {
  const { data, error } = await database.from("affiliate_integrations").select("app_id,encrypted_app_secret,status").eq("account_id", accountId).eq("provider", "shopee").maybeSingle();
  if (error) throw error;
  return data;
}

export async function listIntegrations(database: SupabaseClient, accountId: string) {
  const [shopee, mercadoLivre] = await Promise.all([getShopeeIntegration(database, accountId), getMercadoLivreIntegration(database, accountId)]);
  return { shopee, mercado_livre: mercadoLivre, amazon: null };
}

export async function connectShopeeIntegration(database: SupabaseClient, accountId: string, userId: string, input: { app_id: string; app_secret: string }) {
  const now = new Date().toISOString();
  let encryptedSecret: string;
  let fingerprint: string;
  try { encryptedSecret = encryptIntegrationSecret(input.app_secret); fingerprint = credentialFingerprint(input.app_id, input.app_secret); }
  catch (error) { console.error({ event: "shopee_credentials_encryption_failed", component: "integrations", account_id: accountId, error_type: error instanceof Error ? error.name : "unknown" }); throw new Error("INTEGRATION_ENCRYPTION_UNAVAILABLE"); }
  try {
    await testShopeeCredentials(input.app_id, input.app_secret);
    const { error } = await database.from("affiliate_integrations").upsert({ account_id: accountId, user_id: userId, provider: "shopee", app_id: input.app_id, encrypted_app_secret: encryptedSecret, credential_fingerprint: fingerprint, status: "connected", last_tested_at: now, last_error: null, updated_at: now }, { onConflict: "account_id,provider" });
    if (error) throw error;
    return { status: "connected", app_id: input.app_id };
  } catch (error) {
    const message = error instanceof Error && /Credenciais|Limite|Shopee/.test(error.message) ? error.message : "Não foi possível conectar à Shopee. Verifique App ID e App Secret.";
    await database.from("affiliate_integrations").upsert({ account_id: accountId, user_id: userId, provider: "shopee", app_id: input.app_id, encrypted_app_secret: encryptedSecret, credential_fingerprint: fingerprint, status: "error", last_tested_at: now, last_error: message, updated_at: now }, { onConflict: "account_id,provider" });
    console.error({ event: "shopee_connection_failed", component: "integrations", account_id: accountId, error_type: error instanceof Error ? error.name : "unknown" });
    throw new Error(message);
  }
}

export async function startMercadoLivreIntegration(database: SupabaseClient, accountId: string, userId: string) {
  const nonce = secretToken(); const now = new Date(); const expiresAt = new Date(now.getTime() + 5 * 60_000).toISOString();
  const { error } = await database.from("affiliate_connection_nonces").insert({ account_id: accountId, provider: "mercado_livre", nonce_hash: tokenHash(nonce), expires_at: expiresAt, created_by: userId });
  if (error) throw error;
  return { nonce, expires_at: expiresAt };
}

export async function disconnectIntegration(database: SupabaseClient, accountId: string, provider: StoredProvider) {
  if (provider === "shopee") {
    const { error } = await database.from("affiliate_integrations").update({ status: "disconnected", encrypted_app_secret: null, credential_fingerprint: null, last_error: null, updated_at: new Date().toISOString() }).eq("account_id", accountId).eq("provider", provider);
    if (error) throw error;
    return { status: "disconnected" };
  }
  const { error } = await database.from("affiliate_integrations").update({ status: "disconnected", extension_token_hash: null, encrypted_auth_data: null, auth_expires_at: null, last_error: null, updated_at: new Date().toISOString() }).eq("account_id", accountId).eq("provider", provider);
  if (error) throw error;
  return { status: "disconnected" };
}
