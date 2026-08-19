import { NextRequest, NextResponse } from "next/server";
import { requireInternalAdmin } from "@/lib/internal-admin";
import { env } from "@/lib/env";
import { verifyMercadoLivreOAuthState } from "@/modules/affiliate-catalog/server/mercado-livre-oauth-state";
import { completeMercadoLivreAuthorization } from "@/modules/affiliate-catalog/server/mercado-livre-token-manager";

export async function GET(request: NextRequest) {
  const guard = await requireInternalAdmin();
  if (guard.error) return NextResponse.redirect(new URL("/admin/mercado-livre-catalog?error=not_admin", request.url));

  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  const validState = state && (await verifyMercadoLivreOAuthState(state, new TextEncoder().encode(env().AUTH_SECRET)));
  if (!code || !validState) {
    return NextResponse.redirect(new URL("/admin/mercado-livre-catalog?error=invalid_state", request.url));
  }

  try {
    await completeMercadoLivreAuthorization(code, guard.session.email);
  } catch {
    return NextResponse.redirect(new URL("/admin/mercado-livre-catalog?error=exchange_failed", request.url));
  }
  return NextResponse.redirect(new URL("/admin/mercado-livre-catalog?connected=1", request.url));
}
