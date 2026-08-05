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

export async function requireAccountContext() {
  const session = await getSession();
  if (!session?.userId || !session.accountId) return { error: NextResponse.json({ error: "Não autorizado." }, { status: 401 }) };
  const database = await supabaseAuth();
  const { data: authData, error: authError } = await database.auth.getUser();
  if (authError || authData.user?.id !== session.userId) return { error: NextResponse.json({ error: "Sessão de autenticação inválida." }, { status: 401 }) };
  const { data } = await database.from("app_users").select("account_id,status,accounts(status,plan,name)").eq("id", session.userId).eq("account_id", session.accountId).maybeSingle();
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
