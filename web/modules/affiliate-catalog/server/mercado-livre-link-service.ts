import { createHash } from "crypto";

const ALLOWED_HOSTS = new Set(["mercadolivre.com.br", "www.mercadolivre.com.br", "produto.mercadolivre.com.br"]);
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

export function normalizeMercadoLivreProductUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== "https:" || !ALLOWED_HOSTS.has(url.hostname.toLowerCase())) throw new Error("MERCADO_LIVRE_INVALID_URL");
  url.hash = "";
  for (const key of [...url.searchParams.keys()]) if (/^(utm_|matt_|tracking|quantity$)/i.test(key)) url.searchParams.delete(key);
  return url.toString();
}

async function integrationFor(database: any, accountId: string) {
  const { data, error } = await database.from("affiliate_integrations").select("id,status,affiliate_tag,extension_token_hash").eq("account_id", accountId).eq("provider", "mercado_livre").maybeSingle();
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
