import type { SupabaseClient } from "@supabase/supabase-js";
import { extractReferralCodeFromHubla, firstNameOnly } from "../rules";

const PAYMENT_EVENTS = new Set(["subscription.activated", "invoice.payment_succeeded"]);
const REFUND_EVENTS = new Set(["subscription.refunded", "payment.refunded"]);
// subscription.activated e invoice.payment_succeeded da mesma compra podem
// chegar em momentos diferentes. Conta criada há até 48 h ainda é cliente novo.
const NEW_CUSTOMER_WINDOW_MS = 48 * 60 * 60 * 1000;

export type HublaReferralInput = {
  body: Record<string, any>;
  eventType: string;
  email: string;
  firstName?: string | null;
  account: { id: string; created_at?: string | null };
  accountCreated: boolean;
  idempotencyKey: string;
  now?: Date;
};

export type ReferralWebhookResult =
  | "ignored" | "no_code" | "unknown_code" | "self_referral" | "existing_customer"
  | "already_registered" | "registered" | "refunded" | "error";

function isNewCustomer(input: HublaReferralInput) {
  if (input.accountCreated) return true;
  const createdAt = input.account.created_at ? Date.parse(input.account.created_at) : NaN;
  if (!Number.isFinite(createdAt)) return false;
  return (input.now ?? new Date()).getTime() - createdAt <= NEW_CUSTOMER_WINDOW_MS;
}

/**
 * Registra a indicação a partir do evento da Hubla. Nunca lança erro: uma
 * falha aqui não pode impedir a criação ou ativação da conta.
 * Todas as escritas usam service_role com filtro explícito de conta.
 */
export async function recordHublaReferral(admin: SupabaseClient, input: HublaReferralInput): Promise<ReferralWebhookResult> {
  try {
    const now = (input.now ?? new Date()).toISOString();

    if (REFUND_EVENTS.has(input.eventType)) {
      const { data, error } = await admin.from("referrals")
        .update({ status: "refunded", refunded_at: now, updated_at: now })
        .eq("referred_account_id", input.account.id)
        .neq("status", "refunded")
        .select("id");
      if (error) throw error;
      return data?.length ? "refunded" : "ignored";
    }
    if (!PAYMENT_EVENTS.has(input.eventType)) return "ignored";

    const code = extractReferralCodeFromHubla(input.body);
    if (!code) return "no_code";

    const existing = await admin.from("referrals").select("id,status")
      .eq("referred_account_id", input.account.id).maybeSingle();
    if (existing.error) throw existing.error;
    if (existing.data) {
      // Repetição do webhook ou segundo evento da mesma compra. Pendente vira
      // pagante; reembolsado continua fora da contagem.
      if (existing.data.status === "pending") {
        const promoted = await admin.from("referrals")
          .update({ status: "paying", paid_at: now, updated_at: now })
          .eq("id", existing.data.id).eq("referred_account_id", input.account.id).eq("status", "pending");
        if (promoted.error) throw promoted.error;
      }
      return "already_registered";
    }

    if (!isNewCustomer(input)) return "existing_customer";

    const referrer = await admin.from("referral_profiles").select("account_id").eq("code", code).maybeSingle();
    if (referrer.error) throw referrer.error;
    if (!referrer.data) return "unknown_code";
    const referrerAccountId = referrer.data.account_id as string;
    if (referrerAccountId === input.account.id) return "self_referral";

    const sameEmail = await admin.from("app_users").select("id")
      .eq("account_id", referrerAccountId).eq("email", input.email.toLowerCase()).limit(1);
    if (sameEmail.error) throw sameEmail.error;
    if (sameEmail.data?.length) return "self_referral";

    const inserted = await admin.from("referrals").upsert({
      referrer_account_id: referrerAccountId,
      referred_account_id: input.account.id,
      referral_code: code,
      referred_first_name: firstNameOnly(input.firstName),
      status: "paying",
      paid_at: now,
      source_event: input.eventType,
      source_idempotency_key: input.idempotencyKey.slice(0, 200),
    }, { onConflict: "referred_account_id", ignoreDuplicates: true });
    if (inserted.error) throw inserted.error;
    return "registered";
  } catch (error) {
    const message = error instanceof Error ? error.message : String((error as { message?: unknown })?.message ?? "erro desconhecido");
    console.error("[indicacao] falha ao registrar indicação da Hubla:", message.slice(0, 300));
    return "error";
  }
}
