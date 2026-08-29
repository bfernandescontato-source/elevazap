import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { adminAccountSchema } from "../modules/admin/server/account-provisioning";

describe("provisionamento administrativo de contas", () => {
  it("aceita a senha padrão e os três planos disponíveis", () => {
    for (const plan of ["start", "pro", "scale"]) {
      expect(adminAccountSchema.safeParse({ name: "Conta Teste", email: "CLIENTE@EXAMPLE.COM", password: "123456", plan }).success).toBe(true);
    }
  });

  it("normaliza o e-mail e rejeita senha curta ou plano desconhecido", () => {
    const valid = adminAccountSchema.parse({ name: "Conta Teste", email: " CLIENTE@EXAMPLE.COM ", password: "123456", plan: "start" });
    expect(valid.email).toBe("cliente@example.com");
    expect(adminAccountSchema.safeParse({ ...valid, password: "123" }).success).toBe(false);
    expect(adminAccountSchema.safeParse({ ...valid, plan: "enterprise" }).success).toBe(false);
  });

  it("protege criação e listagem com o administrador interno", () => {
    const route = readFileSync(resolve(process.cwd(), "app/api/admin/accounts/route.ts"), "utf8");
    expect(route).toContain("requireInternalAdmin");
    expect(route).toContain("guardInternalAdminMutation");
    expect(route).toContain("internal_admin_create_account_ip");
  });
});
