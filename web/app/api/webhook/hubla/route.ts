import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { env } from "@/lib/env";
import { getPlanFromOfferCode, getPlanLabel } from "@/lib/plans";

// Status resultante em accounts.status para cada evento da Hubla.
// Adicione novos eventos aqui quando confirmados (ex: subscription.updated).
const EVENT_STATUS: Record<string, "active" | "cancelled" | "expired" | "refunded"> = {
  "subscription.activated":   "active",
  "subscription.reactivated": "active",
  // "subscription.updated": "active",  // upgrade/downgrade — confirmar nome do evento
  "subscription.cancelled": "cancelled",
  "subscription.canceled":  "cancelled",
  "subscription.expired":   "expired",
  "subscription.refunded":  "refunded",
  "payment.refunded":       "refunded",
};

const INITIAL_PASSWORD = "123456";

function safePayload(body: Record<string, unknown>) {
  const clone = JSON.parse(JSON.stringify(body));
  const scrub = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(scrub);
    if (value && typeof value === "object") return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) =>
        [key, /password|token|secret|authorization/i.test(key) ? "[REDACTED]" : scrub(item)]
      )
    );
    return value;
  };
  return scrub(clone);
}

export async function POST(request: NextRequest) {
  const configured = env().HUBLA_WEBHOOK_TOKEN;
  if (!configured || request.headers.get("x-hubla-token") !== configured)
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });

  const idempotencyKey = request.headers.get("x-hubla-idempotency")?.trim();
  if (!idempotencyKey)
    return NextResponse.json({ error: "Cabeçalho de idempotência ausente." }, { status: 400 });

  const body = await request.json().catch(() => null) as Record<string, any> | null;
  if (!body) return NextResponse.json({ error: "JSON inválido." }, { status: 400 });

  const eventType = String(body.type || "");
  if (!EVENT_STATUS[eventType]) return NextResponse.json({ ok: true, ignored: true });

  // Extração de dados do payload (com fallbacks para variações da Hubla)
  const event       = body.event || body.data || body;
  const user        = event.user || body.user || {};
  const subscription = event.subscription || body.subscription || {};

  const email = String(user.email || event.email || "").trim().toLowerCase();
  if (!email.includes("@"))
    return NextResponse.json({ error: "E-mail ausente no evento." }, { status: 400 });

  // Identificação do plano via offer code (campo canônico da Hubla)
  const offerCode  = String(event.products?.[0]?.offers?.[0]?.id || "").trim();
  const planName   = offerCode ? getPlanFromOfferCode(offerCode) : null;

  const admin = supabaseAdmin();
  const audit = {
    idempotency_key: idempotencyKey,
    event_type: eventType,
    email_hash: createHash("sha256").update(email).digest("hex"),
    payload: safePayload(body),
    status: "processing"
  };

  const { error: auditError } = await admin.from("hubla_webhook_events").insert(audit);
  if (auditError) {
    if (/duplicate|unique/i.test(auditError.message))
      return NextResponse.json({ ok: true, duplicate: true });
    return NextResponse.json({ error: "Falha ao registrar evento." }, { status: 500 });
  }

  const subscriptionId = String(
    subscription.id || event.subscriptionId || ""
  ).trim() || null;

  try {
    // Busca conta existente por subscription ID ou por email
    let account: { id: string; owner_user_id: string | null } | null = null;
    if (subscriptionId) {
      const result = await admin.from("accounts").select("id,owner_user_id")
        .eq("hubla_subscription_id", subscriptionId).maybeSingle();
      account = result.data;
    }
    if (!account) {
      const profile = await admin.from("app_users")
        .select("account_id,accounts(id,owner_user_id)")
        .eq("email", email).maybeSingle();
      const related = Array.isArray(profile.data?.accounts)
        ? profile.data.accounts[0]
        : profile.data?.accounts;
      account = related || null;
    }

    if (eventType === "subscription.activated" && !account) {
      // Primeiro acesso: criar conta e usuário
      const name = [user.firstName, user.lastName].filter(Boolean).join(" ").trim()
        || email.split("@")[0];
      const resolvedPlan = planName ?? "start";

      const createdAccount = await admin.from("accounts").insert({
        name,
        status: "active",
        plan: resolvedPlan,
        hubla_subscription_id: subscriptionId,
        subscription_started_at: new Date().toISOString(),
      }).select("id,owner_user_id").single();
      if (createdAccount.error) throw createdAccount.error;
      account = createdAccount.data;

      const createdUser = await admin.auth.admin.createUser({
        email,
        password: INITIAL_PASSWORD,
        email_confirm: true,
        user_metadata: { name, source: "hubla", account_id: account.id }
      });
      if (createdUser.error || !createdUser.data.user)
        throw createdUser.error || new Error("Usuário não criado");

      const userId = createdUser.data.user.id;
      const profile = await admin.from("app_users").upsert({
        id: userId,
        account_id: account.id,
        email,
        name,
        role: "admin",
        status: "active",
        approved_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).select("id").single();
      if (profile.error) throw profile.error;

      const owner = await admin.from("accounts").update({ owner_user_id: userId }).eq("id", account.id);
      if (owner.error) throw owner.error;

    } else if (!account) {
      throw new Error("Conta da assinatura não localizada");
    }

    // Atualiza status (e plano, se offer code presente no evento)
    const status = EVENT_STATUS[eventType];
    const accountUpdate: Record<string, unknown> = {
      status,
      hubla_subscription_id: subscriptionId || undefined,
      updated_at: new Date().toISOString(),
    };
    if (planName) {
      accountUpdate.plan = planName;
    }

    const updated = await admin.from("accounts").update(accountUpdate).eq("id", account.id);
    if (updated.error) throw updated.error;

    await admin.from("hubla_webhook_events").update({
      account_id: account.id,
      status: "processed",
      processed_at: new Date().toISOString(),
    }).eq("idempotency_key", idempotencyKey);

    const planLabel = planName ? getPlanLabel(planName) : null;
    return NextResponse.json({ ok: true, status, ...(planLabel ? { plan: planLabel } : {}) });

  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro desconhecido";
    await admin.from("hubla_webhook_events").update({
      status: "error",
      error: message.slice(0, 500),
      processed_at: new Date().toISOString(),
    }).eq("idempotency_key", idempotencyKey);
    return NextResponse.json({ error: "Não foi possível processar o evento." }, { status: 500 });
  }
}
