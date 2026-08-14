import { NextRequest, NextResponse } from "next/server";
import { requireAccountContext, requireValidOrigin } from "@/lib/security";
import { credentialFingerprint, encryptIntegrationSecret } from "@/lib/integration-crypto";
import { shopeeIntegrationSchema } from "@/modules/offer-autopilot/schemas";
import { testShopeeCredentials } from "@/modules/offer-autopilot/server/shopee-client";

export async function POST(request: NextRequest) {
  const origin = requireValidOrigin(request);
  if (origin) return origin;
  const context = await requireAccountContext();
  if (context.error) return context.error;
  const parsed = shopeeIntegrationSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Informe App ID e App Secret válidos." }, { status: 400 });
  const now = new Date().toISOString();
  let encryptedSecret: string;
  let fingerprint: string;
  try {
    encryptedSecret = encryptIntegrationSecret(parsed.data.app_secret);
    fingerprint = credentialFingerprint(parsed.data.app_id, parsed.data.app_secret);
  } catch (error) {
    console.error({ event: "shopee_credentials_encryption_failed", component: "affiliate-integration", account_id: context.accountId, error_type: error instanceof Error ? error.name : "unknown" });
    return NextResponse.json({ error: "A integração segura ainda não está configurada neste ambiente." }, { status: 503 });
  }
  try {
    await testShopeeCredentials(parsed.data.app_id, parsed.data.app_secret);
    const { error } = await context.database.from("affiliate_integrations").upsert({
      account_id: context.accountId, user_id: context.session.userId, provider: "shopee", app_id: parsed.data.app_id,
      encrypted_app_secret: encryptedSecret, credential_fingerprint: fingerprint,
      status: "connected", last_tested_at: now, last_error: null, updated_at: now
    }, { onConflict: "account_id,provider" });
    if (error) throw error;
    return NextResponse.json({ status: "connected", app_id: parsed.data.app_id });
  } catch (error) {
    const message = error instanceof Error && /Credenciais|Limite|Shopee/.test(error.message) ? error.message : "Não foi possível conectar à Shopee. Verifique App ID e App Secret.";
    await context.database.from("affiliate_integrations").upsert({
      account_id: context.accountId, user_id: context.session.userId, provider: "shopee", app_id: parsed.data.app_id,
      encrypted_app_secret: encryptedSecret, credential_fingerprint: fingerprint,
      status: "error", last_tested_at: now, last_error: message, updated_at: now
    }, { onConflict: "account_id,provider" });
    console.error({ event: "shopee_connection_failed", component: "affiliate-integration", account_id: context.accountId, error_type: error instanceof Error ? error.name : "unknown" });
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
