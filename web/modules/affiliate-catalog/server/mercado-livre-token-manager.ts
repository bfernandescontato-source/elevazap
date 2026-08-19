import { randomUUID } from "crypto";
import { supabaseAdmin } from "@/lib/supabase";
import { decryptIntegrationSecret, encryptIntegrationSecret } from "@/lib/integration-crypto";
import { exchangeMercadoLivreCode, refreshMercadoLivreToken, type MercadoLivreTokenResponse } from "./mercado-livre-oauth-client";
import { MercadoLivreAffiliateProvider } from "./mercado-livre-provider";
import { withAuthRetry } from "./mercado-livre-auth-retry";

const LOCK_ID = "mercado-livre-oauth-refresh";
const EXPIRY_SKEW_MS = 60_000;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readRow() {
  const { data, error } = await supabaseAdmin().from("mercado_livre_platform_integration").select("*").eq("id", 1).single();
  if (error) throw error;
  return data;
}

async function saveTokens(tokens: MercadoLivreTokenResponse) {
  const { error } = await supabaseAdmin().from("mercado_livre_platform_integration").update({
    encrypted_access_token: encryptIntegrationSecret(tokens.access_token),
    encrypted_refresh_token: encryptIntegrationSecret(tokens.refresh_token),
    access_token_expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
    mercado_livre_user_id: tokens.user_id ? String(tokens.user_id) : undefined,
    scope: tokens.scope,
    status: "connected",
    last_refreshed_at: new Date().toISOString(),
    last_error: null,
    updated_at: new Date().toISOString()
  }).eq("id", 1);
  if (error) throw error;
}

async function markStatus(status: string, lastError: string | null) {
  await supabaseAdmin().from("mercado_livre_platform_integration")
    .update({ status, last_error: lastError, updated_at: new Date().toISOString() }).eq("id", 1);
}

async function refreshWithLock(): Promise<string> {
  const instanceId = randomUUID();
  const { data: acquired, error } = await supabaseAdmin().rpc("acquire_service_lock", {
    p_id: LOCK_ID, p_instance_id: instanceId, p_ttl_seconds: 20
  });
  if (error) throw error;

  if (acquired) {
    const row = await readRow();
    if (!row.encrypted_refresh_token) throw new Error("MERCADO_LIVRE_REAUTHORIZATION_REQUIRED");
    try {
      const fresh = await refreshMercadoLivreToken(decryptIntegrationSecret(row.encrypted_refresh_token));
      await saveTokens(fresh);
      return fresh.access_token;
    } catch (refreshError) {
      await markStatus("error", refreshError instanceof Error ? refreshError.message : "MERCADO_LIVRE_REFRESH_FAILED");
      throw refreshError;
    }
  }

  // Outra invocação já está renovando — espera curta e limitada relendo a linha, sem bloquear indefinidamente.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await sleep(700);
    const latest = await readRow();
    const latestExpiry = latest.access_token_expires_at ? new Date(latest.access_token_expires_at).getTime() : 0;
    if (latest.encrypted_access_token && latestExpiry - Date.now() > EXPIRY_SKEW_MS) {
      return decryptIntegrationSecret(latest.encrypted_access_token);
    }
  }
  const fallback = await readRow();
  if (!fallback.encrypted_access_token) throw new Error("MERCADO_LIVRE_REAUTHORIZATION_REQUIRED");
  return decryptIntegrationSecret(fallback.encrypted_access_token);
}

export async function getMercadoLivreAccessToken(): Promise<string> {
  const row = await readRow();
  if (!row.encrypted_access_token || !row.encrypted_refresh_token) throw new Error("MERCADO_LIVRE_NOT_CONFIGURED");
  const expiresAt = row.access_token_expires_at ? new Date(row.access_token_expires_at).getTime() : 0;
  if (expiresAt - Date.now() > EXPIRY_SKEW_MS) return decryptIntegrationSecret(row.encrypted_access_token);
  return refreshWithLock();
}

export async function getMercadoLivreClient(): Promise<MercadoLivreAffiliateProvider> {
  return new MercadoLivreAffiliateProvider(await getMercadoLivreAccessToken());
}

export async function withMercadoLivreAuthRetry<T>(fn: (client: MercadoLivreAffiliateProvider) => Promise<T>): Promise<T> {
  return withAuthRetry(
    async () => fn(await getMercadoLivreClient()),
    {
      refresh: async () => { await refreshWithLock(); },
      markReauthRequired: async () => { await markStatus("reauthorization_required", "MERCADO_LIVRE_AUTH após tentativa de renovação"); }
    }
  );
}

export async function completeMercadoLivreAuthorization(code: string, connectedByEmail: string) {
  const tokens = await exchangeMercadoLivreCode(code);
  await saveTokens(tokens);
  const { error } = await supabaseAdmin().from("mercado_livre_platform_integration")
    .update({ connected_by_email: connectedByEmail, connected_at: new Date().toISOString() }).eq("id", 1);
  if (error) throw error;
}

export async function disconnectMercadoLivre() {
  const { error } = await supabaseAdmin().from("mercado_livre_platform_integration").update({
    status: "disconnected", encrypted_access_token: null, encrypted_refresh_token: null,
    access_token_expires_at: null, last_error: null, updated_at: new Date().toISOString()
  }).eq("id", 1);
  if (error) throw error;
}

export async function readMercadoLivreStatus() {
  const { data, error } = await supabaseAdmin().from("mercado_livre_platform_integration")
    .select("status,connected_by_email,connected_at,last_refreshed_at,access_token_expires_at,last_error")
    .eq("id", 1).single();
  if (error) throw error;
  return data;
}
