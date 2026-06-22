import { NextRequest, NextResponse } from "next/server";
import { env } from "./env";
import { getSession } from "./auth";
import { supabaseAdmin } from "./supabase";

export async function requireAdmin() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  return null;
}

export function requireValidOrigin(request: NextRequest) {
  const method = request.method.toUpperCase();
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(method)) return null;
  const expected = env().NEXT_PUBLIC_APP_URL;
  const origin = request.headers.get("origin");
  const referer = request.headers.get("referer");
  const allowed = origin === expected || (referer ? referer.startsWith(`${expected}/`) : false);
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
