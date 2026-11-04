import { describe, expect, it } from "vitest";
import { accountSessionFor } from "@/lib/account-session";
import type { AppUserProfile } from "@/lib/user-access";

const profile = (over: Partial<AppUserProfile> = {}): AppUserProfile => ({
  id: "u1", email: "aluna@x.com", name: "Aluna", role: "admin", status: "active", account_id: "acc1",
  accounts: { status: "active", plan: "start", name: "Conta" }, ...over
});

describe("sessão do painel (senha e link no e-mail)", () => {
  it("grava a conta na sessão, senão as telas mostram Não autorizado", () => {
    const result = accountSessionFor(profile());
    expect(result).toEqual({ ok: true, session: expect.objectContaining({ userId: "u1", accountId: "acc1", accountStatus: "active" }) });
  });

  it("aceita a conta vinda como lista", () => {
    expect(accountSessionFor(profile({ accounts: [{ status: "active", plan: "start", name: "Conta" }] })).ok).toBe(true);
  });

  it("recusa usuário ou conta fora do ar, com o motivo", () => {
    expect(accountSessionFor(profile({ status: "pending" }))).toEqual({ ok: false, reason: "pending" });
    expect(accountSessionFor(profile({ accounts: { status: "expired", plan: "start", name: "Conta" } }))).toEqual({ ok: false, reason: "expired" });
    expect(accountSessionFor(profile({ accounts: null }))).toEqual({ ok: false, reason: "account" });
  });
});
