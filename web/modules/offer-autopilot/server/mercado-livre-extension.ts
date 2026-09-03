import { createHash, randomBytes, timingSafeEqual } from "crypto";
import { supabaseAdmin } from "@/lib/supabase";
import { env } from "@/lib/env";

export const MERCADO_LIVRE_CONNECTION_TEST_URL = "https://www.mercadolivre.com.br/creatina-1kg-suplemento-monohidratada-em-po-100-pura-soldiers-nutrition/p/MLB18725310?pdp_filters=item_id%3AMLB6713010960";

export function secretToken(bytes = 32) { return randomBytes(bytes).toString("base64url"); }
export function tokenHash(value: string) { return createHash("sha256").update(value).digest("hex"); }

export function safeBearer(request: Request) {
  const header = request.headers.get("authorization") || "";
  const match = header.match(/^Bearer\s+([A-Za-z0-9_-]{32,})$/);
  return match?.[1] || null;
}

export async function requireMercadoLivreExtension(request: Request) {
  const token = safeBearer(request);
  if (!token) return null;
  const hash = tokenHash(token);
  const { data } = await supabaseAdmin().from("affiliate_integrations")
    .select("id,account_id,status,affiliate_tag,extension_token_hash")
    .eq("provider", "mercado_livre").eq("extension_token_hash", hash).maybeSingle();
  if (!data?.extension_token_hash) return null;
  const stored = Buffer.from(data.extension_token_hash, "hex");
  const received = Buffer.from(hash, "hex");
  if (stored.length !== received.length || !timingSafeEqual(stored, received)) return null;
  return data;
}

export async function requireMercadoLivreCatalogCollector(request: Request) {
  const token = safeBearer(request);
  if (!token) return false;
  const configured = env().MERCADO_LIVRE_COLLECTOR_TOKEN_HASH;
  if (configured) {
    const received = Buffer.from(tokenHash(token), "hex"); const stored = Buffer.from(configured, "hex");
    if (received.length === stored.length && timingSafeEqual(received, stored)) return true;
  }
  return Boolean(await requireMercadoLivreExtension(request));
}

export const extensionCorsHeaders = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization,content-type",
  "access-control-allow-methods": "GET,POST,OPTIONS",
  "cache-control": "no-store"
};
