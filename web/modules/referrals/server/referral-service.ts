import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/lib/supabase";
import { generateReferralCode, referralLink, summarizeReferrals, type ReferralStatus } from "../rules";

type Database = SupabaseClient;

export class ReferralError extends Error {
  constructor(message: string, public readonly status = 500) {
    super(message);
    this.name = "ReferralError";
  }
}

const MAX_CODE_ATTEMPTS = 6;

/**
 * Cria o código da conta na primeira vez que o aluno abre a tela. O navegador
 * não pode escrever o código; a criação usa service_role sempre com o
 * account_id da sessão.
 */
async function createReferralProfile(accountId: string, accountName: string | null | undefined) {
  const admin = supabaseAdmin({ timeoutMs: 8_000 });
  for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt += 1) {
    const code = generateReferralCode(accountName, attempt);
    const { error } = await admin.from("referral_profiles").insert({ account_id: accountId, code });
    if (!error) return;
    if (!/duplicate|unique/i.test(error.message)) throw new ReferralError("Não foi possível criar seu código agora.");
    // Outra aba já criou o código desta conta: não tenta de novo.
    const existing = await admin.from("referral_profiles").select("account_id").eq("account_id", accountId).maybeSingle();
    if (existing.data) return;
  }
  throw new ReferralError("Não foi possível criar seu código agora. Tente de novo.");
}

async function readProfile(database: Database, accountId: string) {
  const { data, error } = await database.from("referral_profiles")
    .select("code,pix_key").eq("account_id", accountId).maybeSingle();
  if (error) throw new ReferralError("Não foi possível carregar sua indicação.");
  return data as { code: string; pix_key: string | null } | null;
}

export async function getReferralOverview(database: Database, accountId: string, accountName?: string | null) {
  let profile = await readProfile(database, accountId);
  if (!profile) {
    await createReferralProfile(accountId, accountName);
    profile = await readProfile(database, accountId);
  }
  if (!profile) throw new ReferralError("Não foi possível carregar seu código.");

  const [referrals, payouts] = await Promise.all([
    database.from("referrals")
      .select("id,referred_first_name,status,created_at,paid_at,refunded_at")
      .eq("referrer_account_id", accountId)
      .order("created_at", { ascending: false })
      .limit(500),
    database.from("referral_payouts")
      .select("id,amount_cents,paid_at")
      .eq("referrer_account_id", accountId)
      .order("paid_at", { ascending: false })
      .limit(200),
  ]);
  if (referrals.error || payouts.error) throw new ReferralError("Não foi possível carregar suas indicações.");

  const referralRows = (referrals.data || []) as Array<{ id: string; referred_first_name: string | null; status: ReferralStatus; created_at: string }>;
  const payoutRows = (payouts.data || []) as Array<{ id: string; amount_cents: number; paid_at: string }>;
  return {
    code: profile.code,
    link: referralLink(profile.code),
    pixKey: profile.pix_key,
    summary: summarizeReferrals(referralRows.map((row) => row.status), payoutRows.map((row) => row.amount_cents)),
    referrals: referralRows.map((row) => ({ id: row.id, firstName: row.referred_first_name || "Aluno", status: row.status, createdAt: row.created_at })),
    payouts: payoutRows.map((row) => ({ id: row.id, amountCents: row.amount_cents, paidAt: row.paid_at })),
  };
}

export async function updatePixKey(database: Database, accountId: string, pixKey: string | null) {
  const { data, error } = await database.from("referral_profiles")
    .update({ pix_key: pixKey, updated_at: new Date().toISOString() })
    .eq("account_id", accountId)
    .select("account_id");
  if (error) throw new ReferralError("Não foi possível salvar a chave PIX.");
  if (!data?.length) throw new ReferralError("Abra a tela de indicação de novo e tente outra vez.", 404);
}
