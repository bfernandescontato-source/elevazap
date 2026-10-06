import { createHash } from "crypto";
import { createMercadoLivreLinkWithSession } from "@disparei/affiliate-links/mercado-livre-session";
import { decryptIntegrationSecret } from "@/lib/integration-crypto";

const ALLOWED_HOSTS = new Set(["mercadolivre.com.br", "www.mercadolivre.com.br", "produto.mercadolivre.com.br"]);
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

/** Com a sessão ML guardada, gera o meli.la pelo servidor (sem o PC do afiliado). null = cai na fila da extensão. */
async function tryStoredSession(database: any, accountId: string, integration: any, resolvedUrl: string) {
  if (!integration.encrypted_session_cookies || integration.session_status === "invalid") return null;
  let cookies: Record<string, string>;
  try { cookies = JSON.parse(decryptIntegrationSecret(integration.encrypted_session_cookies)); } catch { return null; }
  try { return await createMercadoLivreLinkWithSession({ cookies, productUrl: resolvedUrl, tag: integration.affiliate_tag }); }
  catch (error) {
    if (error instanceof Error && (error as any).code === "SESSION_INVALID") await database.from("affiliate_integrations").update({ session_status: "invalid", updated_at: new Date().toISOString() }).eq("id", integration.id).eq("account_id", accountId);
    return null;
  }
}

export function normalizeMercadoLivreProductUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== "https:" || !ALLOWED_HOSTS.has(url.hostname.toLowerCase())) throw new Error("MERCADO_LIVRE_INVALID_URL");
  url.hash = "";
  for (const key of [...url.searchParams.keys()]) if (/^(utm_|matt_|tracking|quantity$)/i.test(key)) url.searchParams.delete(key);
  return url.toString();
}

async function integrationFor(database: any, accountId: string) {
  const { data, error } = await database.from("affiliate_integrations").select("id,status,affiliate_tag,extension_token_hash,encrypted_session_cookies,session_status").eq("account_id", accountId).eq("provider", "mercado_livre").maybeSingle();
  if (error) throw error;
  if (!data || data.status !== "connected" || !data.extension_token_hash) throw new Error("MERCADO_LIVRE_EXTENSION_NOT_CONNECTED");
  return data;
}

export async function startMercadoLivreAffiliateLink(database: any, accountId: string, productUrl: string, itemId: string) {
  const integration = await integrationFor(database, accountId);
  const resolvedUrl = normalizeMercadoLivreProductUrl(productUrl);
  const credentialFingerprint = sha256(`mercado_livre:${integration.extension_token_hash}`);
  const resolvedUrlHash = sha256(resolvedUrl);
  const affiliateTag = integration.affiliate_tag || "";
  const { data: cached, error: cacheError } = await database.from("affiliate_link_cache").select("affiliate_link").eq("account_id", accountId).eq("provider", "mercado_livre").eq("credential_fingerprint", credentialFingerprint).eq("resolved_url_hash", resolvedUrlHash).eq("affiliate_tag", affiliateTag).gt("expires_at", new Date().toISOString()).maybeSingle();
  if (cacheError) throw cacheError;
  if (cached?.affiliate_link) return { status: "completed" as const, affiliateUrl: cached.affiliate_link as string };
  // Caminho sem PC ligado: tenta gerar pelo servidor com a sessão guardada antes de depender da extensão.
  const fromSession = await tryStoredSession(database, accountId, integration, resolvedUrl);
  if (fromSession) {
    await database.from("affiliate_link_cache").upsert({
      account_id: accountId, provider: "mercado_livre", credential_fingerprint: credentialFingerprint,
      item_id: itemId, resolved_url_hash: resolvedUrlHash, resolved_url: resolvedUrl,
      affiliate_link: fromSession, affiliate_tag: affiliateTag, expires_at: new Date(Date.now() + 30 * 24 * 60 * 60_000).toISOString()
    }, { onConflict: "account_id,provider,credential_fingerprint,resolved_url_hash,affiliate_tag" });
    return { status: "completed" as const, affiliateUrl: fromSession };
  }
  const { data: job, error } = await database.from("affiliate_generation_jobs").insert({
    account_id: accountId, provider: "mercado_livre", kind: "conversion", input_url: resolvedUrl,
    affiliate_tag: integration.affiliate_tag || null, item_id: itemId, status: "pending",
    expires_at: new Date(Date.now() + 2 * 60_000).toISOString()
  }).select("id").single();
  if (error) throw error;
  return { status: "pending" as const, jobId: job.id as string };
}

export async function pollMercadoLivreAffiliateLink(database: any, accountId: string, jobId: string) {
  const integration = await integrationFor(database, accountId);
  const { data: job, error } = await database.from("affiliate_generation_jobs").select("status,affiliate_link,input_url,item_id,error_code,error_message,expires_at").eq("id", jobId).eq("account_id", accountId).eq("provider", "mercado_livre").maybeSingle();
  if (error) throw error;
  if (!job) throw new Error("MERCADO_LIVRE_JOB_NOT_FOUND");
  if (["pending", "claimed"].includes(job.status) && new Date(job.expires_at).getTime() <= Date.now()) return { status: "expired" as const };
  if (job.status !== "completed" || !job.affiliate_link) return { status: job.status as "pending" | "claimed" | "failed" | "expired", error: job.error_message || undefined };
  if (!/^https:\/\/meli\.la\//i.test(job.affiliate_link)) throw new Error("MERCADO_LIVRE_INVALID_AFFILIATE_LINK");
  const affiliateTag = integration.affiliate_tag || "";
  await database.from("affiliate_link_cache").upsert({
    account_id: accountId, provider: "mercado_livre", credential_fingerprint: sha256(`mercado_livre:${integration.extension_token_hash}`),
    item_id: job.item_id || "", resolved_url_hash: sha256(job.input_url), resolved_url: job.input_url,
    affiliate_link: job.affiliate_link, affiliate_tag: affiliateTag,
    expires_at: new Date(Date.now() + 30 * 24 * 60 * 60_000).toISOString()
  }, { onConflict: "account_id,provider,credential_fingerprint,resolved_url_hash,affiliate_tag" });
  return { status: "completed" as const, affiliateUrl: job.affiliate_link as string };
}
