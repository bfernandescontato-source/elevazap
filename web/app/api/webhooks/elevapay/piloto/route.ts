import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

import { env } from "@/lib/env";
import { supabaseAdmin } from "@/lib/supabase";

const INITIAL_PASSWORD = "1234567";

function sameSecret(provided: string | null, expected: string) {
  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request: NextRequest) {
  const config = env();
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? null;
  if (!sameSecret(token, config.ELEVAPAY_WEBHOOK_TOKEN)) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }

  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const productId = typeof body?.product_id === "string" ? body.product_id : "";
  if (!config.ELEVAPAY_PILOTO_PRODUCT_ID || productId !== config.ELEVAPAY_PILOTO_PRODUCT_ID) {
    return NextResponse.json({ received: true, ignored: true });
  }

  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const name = typeof body?.name === "string" && body.name.trim() ? body.name.trim() : email.split("@")[0];
  const orderId = typeof body?.order_id === "string" ? body.order_id : "";
  if (!email.includes("@") || !orderId) return NextResponse.json({ error: "Payload inválido." }, { status: 400 });

  const externalId = `elevapay:${orderId}`;
  const admin = supabaseAdmin({ timeoutMs: 15_000 });
  const { data: duplicate } = await admin.from("accounts")
    .select("id").eq("hubla_subscription_id", externalId).maybeSingle();
  if (duplicate) return NextResponse.json({ ok: true, duplicate: true });

  const { data: existingProfile, error: lookupError } = await admin.from("app_users")
    .select("id,account_id").eq("email", email).maybeSingle();
  if (lookupError) return NextResponse.json({ error: "Falha ao localizar usuário." }, { status: 500 });

  const startsAt = new Date();
  const endsAt = new Date(startsAt);
  endsAt.setUTCFullYear(endsAt.getUTCFullYear() + 1);
  if (existingProfile) {
    const { error } = await admin.from("accounts").update({
      status: "active", plan: "start", hubla_subscription_id: externalId,
      subscription_started_at: startsAt.toISOString(), subscription_ends_at: endsAt.toISOString(),
      updated_at: startsAt.toISOString(),
    }).eq("id", existingProfile.account_id);
    if (error) return NextResponse.json({ error: "Falha ao liberar conta." }, { status: 500 });
    return NextResponse.json({ ok: true, created: false, expires_at: endsAt.toISOString() });
  }

  const accountResult = await admin.from("accounts").insert({
    name, status: "active", plan: "start", hubla_subscription_id: externalId,
    subscription_started_at: startsAt.toISOString(), subscription_ends_at: endsAt.toISOString(),
  }).select("id").single();
  if (accountResult.error || !accountResult.data) return NextResponse.json({ error: "Falha ao criar conta." }, { status: 500 });

  const userResult = await admin.auth.admin.createUser({
    email, password: INITIAL_PASSWORD, email_confirm: true,
    user_metadata: { name },
    app_metadata: { account_id: accountResult.data.id, provisioning_source: "elevapay" },
  });
  if (userResult.error || !userResult.data.user) {
    await admin.from("accounts").delete().eq("id", accountResult.data.id);
    return NextResponse.json({ error: "Falha ao criar usuário." }, { status: 500 });
  }

  const userId = userResult.data.user.id;
  const { error: profileError } = await admin.from("app_users").upsert({
    id: userId, account_id: accountResult.data.id, email, name,
    role: "admin", status: "active", approved_at: startsAt.toISOString(), updated_at: startsAt.toISOString(),
  });
  const { error: ownerError } = await admin.from("accounts")
    .update({ owner_user_id: userId }).eq("id", accountResult.data.id);
  if (profileError || ownerError) return NextResponse.json({ error: "Falha ao vincular usuário." }, { status: 500 });

  return NextResponse.json({ ok: true, created: true, expires_at: endsAt.toISOString() });
}
