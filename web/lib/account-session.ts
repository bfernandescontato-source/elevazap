import type { AppSession } from "@/lib/auth";
import type { AppUserProfile } from "@/lib/user-access";

export type AccountSessionResult =
  | { ok: true; session: Partial<AppSession> }
  | { ok: false; reason: string };

/**
 * Regra única para abrir a sessão do painel, seja por senha, por link no e-mail ou por link com token.
 * Antes o login por link não gravava a conta e todas as telas mostravam "Não autorizado".
 */
export function accountSessionFor(profile: AppUserProfile): AccountSessionResult {
  if (profile.status !== "active") return { ok: false, reason: profile.status };
  const account = Array.isArray(profile.accounts) ? profile.accounts[0] : profile.accounts;
  if (!profile.account_id || !account || account.status !== "active") return { ok: false, reason: account?.status || "account" };
  return {
    ok: true,
    session: { userId: profile.id, accountId: profile.account_id, accountStatus: account.status, email: profile.email, name: profile.name, role: profile.role, source: "supabase" }
  };
}
