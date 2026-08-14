import { NextRequest, NextResponse } from "next/server";
import { requireAccountContext, requireValidOrigin } from "@/lib/security";
import { secretToken, tokenHash } from "@/modules/offer-autopilot/server/mercado-livre-extension";

export async function POST(request: NextRequest) {
  const origin = requireValidOrigin(request);
  if (origin) return origin;
  const context = await requireAccountContext();
  if (context.error) return context.error;
  const nonce = secretToken();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 5 * 60_000).toISOString();
  const { error } = await context.database.from("affiliate_connection_nonces").insert({
    account_id: context.accountId, provider: "mercado_livre", nonce_hash: tokenHash(nonce),
    expires_at: expiresAt, created_by: context.session.userId
  });
  if (error) return NextResponse.json({ error: "Não foi possível iniciar a conexão." }, { status: 500 });
  await context.database.from("affiliate_integrations").upsert({
    account_id: context.accountId, user_id: context.session.userId, provider: "mercado_livre",
    status: "connecting", last_error: null, updated_at: now.toISOString()
  }, { onConflict: "account_id,provider" });
  return NextResponse.json({ nonce, expires_at: expiresAt });
}

export async function DELETE(request: NextRequest) {
  const origin = requireValidOrigin(request);
  if (origin) return origin;
  const context = await requireAccountContext();
  if (context.error) return context.error;
  const { error } = await context.database.from("affiliate_integrations").update({
    status: "disconnected", extension_token_hash: null, encrypted_auth_data: null,
    auth_expires_at: null, last_error: null, updated_at: new Date().toISOString()
  }).eq("account_id", context.accountId).eq("provider", "mercado_livre");
  return error ? NextResponse.json({ error: "Não foi possível desconectar." }, { status: 500 }) : NextResponse.json({ status: "disconnected" });
}
