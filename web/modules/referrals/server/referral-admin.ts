import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase";
import { summarizeReferrals, type ReferralStatus } from "../rules";
import { ReferralError } from "./referral-service";

export const referralPayoutSchema = z.object({
  accountId: z.string().uuid("Conta inválida."),
  amountCents: z.number().int().positive("Valor inválido.").max(10_000_000, "Valor alto demais."),
  note: z.string().trim().max(300, "Observação muito longa.").optional().nullable(),
});

export type ReferralBalanceRow = {
  accountId: string;
  accountName: string;
  ownerEmail: string | null;
  code: string | null;
  pixKey: string | null;
  payingCount: number;
  earnedCents: number;
  paidOutCents: number;
  balanceCents: number;
  lastPaidAt: string | null;
};

const PAGE = 1000;

async function readAll<T>(fetchPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>) {
  const rows: T[] = [];
  for (let from = 0; from < 20_000; from += PAGE) {
    const { data, error } = await fetchPage(from, from + PAGE - 1);
    if (error) throw new ReferralError("Não foi possível carregar as indicações.");
    rows.push(...(data || []));
    if (!data || data.length < PAGE) break;
  }
  return rows;
}

async function balancesFor(accountIds?: string[]) {
  const admin = supabaseAdmin({ timeoutMs: 8_000 });
  const [referrals, payouts] = await Promise.all([
    readAll<{ referrer_account_id: string; status: ReferralStatus }>((from, to) => {
      let query = admin.from("referrals").select("referrer_account_id,status");
      if (accountIds) query = query.in("referrer_account_id", accountIds);
      return query.order("id").range(from, to);
    }),
    readAll<{ referrer_account_id: string; amount_cents: number; paid_at: string }>((from, to) => {
      let query = admin.from("referral_payouts").select("referrer_account_id,amount_cents,paid_at");
      if (accountIds) query = query.in("referrer_account_id", accountIds);
      return query.order("id").range(from, to);
    }),
  ]);
  const byAccount = new Map<string, { statuses: ReferralStatus[]; payouts: number[]; lastPaidAt: string | null }>();
  const entry = (id: string) => {
    let current = byAccount.get(id);
    if (!current) { current = { statuses: [], payouts: [], lastPaidAt: null }; byAccount.set(id, current); }
    return current;
  };
  for (const row of referrals) entry(row.referrer_account_id).statuses.push(row.status);
  for (const row of payouts) {
    const current = entry(row.referrer_account_id);
    current.payouts.push(row.amount_cents);
    if (!current.lastPaidAt || row.paid_at > current.lastPaidAt) current.lastPaidAt = row.paid_at;
  }
  return byAccount;
}

export async function listReferralBalances(): Promise<ReferralBalanceRow[]> {
  const admin = supabaseAdmin({ timeoutMs: 8_000 });
  const byAccount = await balancesFor();
  const ids = [...byAccount.keys()];
  if (!ids.length) return [];

  const [accounts, profiles, owners] = await Promise.all([
    admin.from("accounts").select("id,name").in("id", ids),
    admin.from("referral_profiles").select("account_id,code,pix_key").in("account_id", ids),
    admin.from("app_users").select("account_id,email,role").in("account_id", ids).eq("role", "admin"),
  ]);
  if (accounts.error || profiles.error || owners.error) throw new ReferralError("Não foi possível carregar os alunos.");

  const names = new Map((accounts.data || []).map((row) => [row.id as string, row.name as string]));
  const profileMap = new Map((profiles.data || []).map((row) => [row.account_id as string, row]));
  const ownerMap = new Map<string, string>();
  for (const row of owners.data || []) if (!ownerMap.has(row.account_id)) ownerMap.set(row.account_id, row.email);

  return ids.map((accountId) => {
    const current = byAccount.get(accountId)!;
    const summary = summarizeReferrals(current.statuses, current.payouts);
    const profile = profileMap.get(accountId);
    return {
      accountId,
      accountName: names.get(accountId) || "Conta sem nome",
      ownerEmail: ownerMap.get(accountId) || null,
      code: profile?.code ?? null,
      pixKey: profile?.pix_key ?? null,
      payingCount: summary.payingCount,
      earnedCents: summary.earnedCents,
      paidOutCents: summary.paidOutCents,
      balanceCents: summary.balanceCents,
      lastPaidAt: current.lastPaidAt,
    };
  }).sort((a, b) => b.balanceCents - a.balanceCents || b.payingCount - a.payingCount);
}

export async function recordReferralPayout(input: z.infer<typeof referralPayoutSchema>, adminEmail: string) {
  const byAccount = await balancesFor([input.accountId]);
  const current = byAccount.get(input.accountId);
  const balance = current ? summarizeReferrals(current.statuses, current.payouts).balanceCents : 0;
  if (balance <= 0) throw new ReferralError("Este aluno não tem saldo a receber.", 409);
  if (input.amountCents > balance) throw new ReferralError("O valor é maior que o saldo a receber.", 409);

  const admin = supabaseAdmin({ timeoutMs: 8_000 });
  const { error } = await admin.from("referral_payouts").insert({
    referrer_account_id: input.accountId,
    amount_cents: input.amountCents,
    note: input.note || null,
    created_by_email: adminEmail,
  });
  if (error) throw new ReferralError("Não foi possível registrar o pagamento.");
  return { balanceCents: balance - input.amountCents };
}
