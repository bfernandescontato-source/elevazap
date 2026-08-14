import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { extensionCorsHeaders, MERCADO_LIVRE_CONNECTION_TEST_URL, secretToken, tokenHash } from "@/modules/offer-autopilot/server/mercado-livre-extension";

export function OPTIONS() { return new NextResponse(null, { status: 204, headers: extensionCorsHeaders }); }

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body.nonce !== "string" || body.nonce.length < 32) return NextResponse.json({ error: "Código de conexão inválido." }, { status: 400, headers: extensionCorsHeaders });
  const admin = supabaseAdmin();
  const now = new Date();
  const hash = tokenHash(body.nonce);
  const { data: nonce } = await admin.from("affiliate_connection_nonces").select("id,account_id,expires_at,used_at")
    .eq("provider", "mercado_livre").eq("nonce_hash", hash).maybeSingle();
  if (!nonce || nonce.used_at || new Date(nonce.expires_at) <= now) return NextResponse.json({ error: "Código expirado ou já utilizado." }, { status: 401, headers: extensionCorsHeaders });
  const { data: consumed } = await admin.from("affiliate_connection_nonces").update({ used_at: now.toISOString() })
    .eq("id", nonce.id).is("used_at", null).select("id").maybeSingle();
  if (!consumed) return NextResponse.json({ error: "Código já utilizado." }, { status: 409, headers: extensionCorsHeaders });
  const extensionToken = secretToken(36);
  const extensionTokenHash = tokenHash(extensionToken);
  const { error: integrationError } = await admin.from("affiliate_integrations").upsert({
    account_id: nonce.account_id, provider: "mercado_livre", status: "connecting",
    extension_token_hash: extensionTokenHash, last_error: null, updated_at: now.toISOString()
  }, { onConflict: "account_id,provider" });
  if (integrationError) return NextResponse.json({ error: "Não foi possível registrar a extensão." }, { status: 500, headers: extensionCorsHeaders });
  await admin.from("affiliate_generation_jobs").insert({
    account_id: nonce.account_id, provider: "mercado_livre", kind: "connection_test",
    input_url: MERCADO_LIVRE_CONNECTION_TEST_URL, status: "pending",
    expires_at: new Date(now.getTime() + 5 * 60_000).toISOString()
  });
  return NextResponse.json({ extension_token: extensionToken, status: "testing" }, { headers: extensionCorsHeaders });
}
