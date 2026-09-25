import { NextRequest, NextResponse } from "next/server";
import { env } from "./env";
import { getSession } from "./auth";
import { supabaseAdmin } from "./supabase";
import { supabaseAuth } from "./supabase-auth";

export async function requireAdmin() {
  const context = await requireAccountContext();
  if (context.error) return context.error;
  if (context.session.role !== "admin") return NextResponse.json({ error: "Apenas administradores podem realizar esta ação." }, { status: 403 });
  return null;
}

// auth.getUser() vai até o servidor de autenticação do Supabase (EUA) em toda
// chamada de API. O mesmo token confirmado há menos de 30 s não precisa ir de
// novo: uma tela abre várias APIs de uma vez, e cada ida custa ~100 ms.
const VERIFIED_TOKEN_TTL_MS = 30_000;
const verifiedTokens = new Map<string, { userId: string; expires: number }>();

async function verifiedAuthUserId(database: Awaited<ReturnType<typeof supabaseAuth>>) {
  const { data: sessionData } = await database.auth.getSession();
  const token = sessionData.session?.access_token;
  const hit = token ? verifiedTokens.get(token) : undefined;
  if (hit && hit.expires > Date.now()) return hit.userId;
  const { data, error } = await database.auth.getUser();
  if (error || !data.user?.id) return null;
  if (token) {
    verifiedTokens.set(token, { userId: data.user.id, expires: Date.now() + VERIFIED_TOKEN_TTL_MS });
    if (verifiedTokens.size > 2000) for (const [key, entry] of verifiedTokens) if (entry.expires <= Date.now()) verifiedTokens.delete(key);
  }
  return data.user.id;
}

export async function requireAccountContext() {
  const session = await getSession();
  if (!session?.userId || !session.accountId) return { error: NextResponse.json({ error: "Não autorizado." }, { status: 401 }) };
  const database = await supabaseAuth();
  // A conferência do login e a leitura da conta seguem em paralelo; a conta só é
  // usada se o login for confirmado.
  const [authUserId, { data }] = await Promise.all([
    verifiedAuthUserId(database),
    database.from("app_users").select("account_id,status,accounts(status,plan,name)").eq("id", session.userId).eq("account_id", session.accountId).maybeSingle()
  ]);
  if (authUserId !== session.userId) return { error: NextResponse.json({ error: "Sessão de autenticação inválida." }, { status: 401 }) };
  const account = Array.isArray(data?.accounts) ? data.accounts[0] : data?.accounts;
  if (!data || data.status !== "active" || account?.status !== "active") return { error: NextResponse.json({ error: "Assinatura inativa.", code: account?.status || data?.status || "authentication_error" }, { status: 403 }) };
  return { accountId: data.account_id as string, account, session, database };
}

export async function requireAdminRole() {
  return requireAdmin();
}

export function requireValidOrigin(request: NextRequest) {
  const method = request.method.toUpperCase();
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(method)) return null;
  const configuredOrigin = new URL(env().NEXT_PUBLIC_APP_URL).origin;
  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const allowedOrigins = new Set([configuredOrigin, request.nextUrl.origin]);
  if (forwardedHost && forwardedProto) allowedOrigins.add(`${forwardedProto}://${forwardedHost}`);

  const origin = request.headers.get("origin");
  const referer = request.headers.get("referer");
  let refererOrigin = "";
  if (referer) {
    try { refererOrigin = new URL(referer).origin; }
    catch { refererOrigin = ""; }
  }
  const allowed = Boolean((origin && allowedOrigins.has(origin)) || (refererOrigin && allowedOrigins.has(refererOrigin)));
  if (!allowed) return NextResponse.json({ error: "Origem inválida." }, { status: 403 });
  return null;
}

export async function persistentRateLimit(key: string, scope: string, limit: number, windowSeconds: number) {
  const supabase = supabaseAdmin();
  const now = new Date();
  const windowStart = new Date(Math.floor(now.getTime() / (windowSeconds * 1000)) * windowSeconds * 1000);
  const expiresAt = new Date(windowStart.getTime() + windowSeconds * 1000);
  const { data, error } = await supabase.rpc("increment_rate_limit", {
    p_key: key,
    p_scope: scope,
    p_window_start: windowStart.toISOString(),
    p_expires_at: expiresAt.toISOString()
  });
  if (error) throw error;
  return Number(data) <= limit;
}

export function clientIp(request: NextRequest) {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

export async function guardAdminMutation(request: NextRequest, scope = "admin_action_ip") {
  const auth = await requireAdmin();
  if (auth) return auth;
  const origin = requireValidOrigin(request);
  if (origin) return origin;
  const allowed = await persistentRateLimit(clientIp(request), scope, 90, 60);
  if (!allowed) return NextResponse.json({ error: "Muitas tentativas. Aguarde um pouco." }, { status: 429 });
  return null;
}
