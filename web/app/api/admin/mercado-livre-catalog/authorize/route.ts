import { NextResponse } from "next/server";
import { requireInternalAdmin } from "@/lib/internal-admin";
import { env } from "@/lib/env";
import { buildMercadoLivreAuthorizationUrl } from "@/modules/affiliate-catalog/server/mercado-livre-oauth-client";
import { signMercadoLivreOAuthState } from "@/modules/affiliate-catalog/server/mercado-livre-oauth-state";

export async function GET() {
  const guard = await requireInternalAdmin();
  if (guard.error) return guard.error;
  const state = await signMercadoLivreOAuthState(new TextEncoder().encode(env().AUTH_SECRET));
  return NextResponse.redirect(buildMercadoLivreAuthorizationUrl(state));
}
