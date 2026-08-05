import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(__dirname, "../..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

describe("isolamento multi-tenant", () => {
  it("cria conta, associa usuário e aplica RLS às tabelas tenant", () => {
    const migration = read("supabase/migrations/015_multi_tenant_accounts.sql");
    expect(migration).toContain("create table if not exists public.accounts");
    expect(migration).toContain("alter table public.app_users alter column account_id set not null");
    expect(migration).toContain("create policy tenant_isolation");
    expect(migration).toContain("public.current_account_is_active()");
  });

  it("rejeita referências entre contas no banco", () => {
    const migration = read("supabase/migrations/015_multi_tenant_accounts.sql");
    expect(migration).toContain("cross-account reference rejected");
    expect(migration).toContain("tenant_campaign_group");
    expect(migration).toContain("tenant_group_item_batch");
    expect(migration).toContain("tenant_support_message");
  });

  it("não aceita account_id arbitrário nas APIs de escrita críticas", () => {
    for (const route of [
      "web/app/api/campanhas/route.ts",
      "web/app/api/lotes/create/route.ts",
      "web/app/api/mensagem/bulk/route.ts",
      "web/app/api/whatsapp/senders/route.ts",
      "web/app/api/webhooks/rules/route.ts"
    ]) {
      const source = read(route);
      expect(source).toContain("requireAccountContext");
      expect(source).toContain("context.accountId");
      expect(source).not.toMatch(/account_id:\s*(body|parsed\.data)\.account_id/);
    }
  });

  it("provisiona Hubla com token, idempotência e senha padrão sem registrar segredo", () => {
    const source = read("web/app/api/webhook/hubla/route.ts");
    expect(source).toContain('x-hubla-token');
    expect(source).toContain('x-hubla-idempotency');
    expect(source).toContain('const INITIAL_PASSWORD = "123456"');
    expect(source).toContain('"[REDACTED]"');
    expect(source).not.toContain("updateUserById");
  });

  it("bloqueia fila quando a assinatura não está ativa", () => {
    const migration = read("supabase/migrations/015_multi_tenant_accounts.sql");
    const queue = read("whatsapp-service/src/queue/queue.ts");
    expect(migration).toContain("a.status='active'");
    expect(queue).toContain('account?.status !== "active"');
    expect(queue).toContain('.eq("account_id", row.account_id)');
  });
});
