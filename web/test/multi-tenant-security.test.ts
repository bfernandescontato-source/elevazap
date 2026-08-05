import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(__dirname, "../..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

describe("isolamento multi-tenant", () => {
  it("mantém IA de suporte e webhooks personalizados descontinuados", () => {
    for (const removedPath of [
      "web/app/api/support/agent/route.ts",
      "web/app/api/webhooks/rules/route.ts",
      "web/app/suporte/page.tsx",
      "web/app/webhooks/page.tsx",
      "whatsapp-service/src/support/runtime.ts"
    ]) {
      expect(existsSync(resolve(root, removedPath))).toBe(false);
    }

    const service = read("whatsapp-service/src/index.ts");
    const migration = read("supabase/migrations/017_decommission_support_ai_and_custom_webhooks.sql");
    expect(service).not.toContain("bootSupportRuntime");
    expect(migration).toContain("set enabled = false");
    expect(migration).toContain("set status = 'inactive'");
  });

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
      "web/app/api/whatsapp/senders/route.ts"
    ]) {
      const source = read(route);
      expect(source).toMatch(/require(AccountContext|TenantDatabase)/);
      expect(source).toMatch(/(context|tenant)\.accountId/);
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

  it("não possui sessão WhatsApp global nem fallback entre contas", () => {
    const index = read("whatsapp-service/src/index.ts");
    const queue = read("whatsapp-service/src/queue/queue.ts");
    const runtime = read("whatsapp-service/src/senders/runtime.ts");
    expect(index).not.toContain("createWhatsAppRuntime");
    expect(queue).not.toContain("getFirstConnectedSenderSock");
    expect(queue).toContain('getSenderSock(row.whatsapp_session_name, row.account_id)');
    expect(queue).toContain('Envio sem número WhatsApp associado à conta.');
    expect(runtime).toContain("managed.accountId !== accountId");
  });

  it("endurece o claim no banco para exigir sessão da mesma conta", () => {
    const migration = read("supabase/migrations/016_tenant_queue_hardening.sql");
    expect(migration).toContain("envios_active_job_requires_session");
    expect(migration).toContain("s.account_id=e.account_id");
    expect(migration).toContain("s.session_name=e.whatsapp_session_name");
    expect(migration).toContain("grant execute on function public.claim_next_envio() to service_role");
  });

  it("mantém o redirecionador funcional quando a sincronização de participantes atrasa", () => {
    const route = read("web/app/c/[slug]/route.ts");
    expect(route).toContain('data?.reason === "nenhum_grupo_confiavel"');
    expect(route).toContain("resolveRedirectFallback(sb, slug)");
    expect(route).not.toContain("ageSeconds > maxAge");
  });

  it("vincula campanhas legadas ao primeiro número da própria conta", () => {
    const webSync = read("web/lib/campaign-group-sync.ts");
    const serviceSync = read("whatsapp-service/src/groups/campaign-sync.ts");
    expect(webSync).toContain('from("whatsapp_senders")');
    expect(webSync).toContain("whatsapp_sender_id: senderId");
    expect(webSync).not.toContain('endpoint = sender?.session_name');
    expect(serviceSync).toContain("firstSenderByAccount");
    expect(serviceSync).toContain('eq("account_id", campaign.account_id)');
  });

  it("usa o cliente autenticado com RLS nas APIs de leitura migradas", () => {
    for (const route of [
      "web/app/api/dashboard/summary/route.ts",
      "web/app/api/envios/route.ts",
      "web/app/api/envios-grupo/route.ts",
      "web/app/api/lotes/route.ts",
      "web/app/api/incertos/route.ts",
      "web/app/api/whatsapp/groups/route.ts"
    ]) {
      const source = read(route);
      expect(source).toContain("requireTenantDatabase");
      expect(source).not.toContain("supabaseAdmin");
    }
  });

  it("expõe monitoramento sem incluir identificadores de outras contas", () => {
    const service = read("whatsapp-service/src/routes/http.ts");
    const dashboard = read("web/app/api/dashboard/summary/route.ts");
    expect(service).toContain('app.get("/metrics"');
    expect(dashboard).toContain('.eq("account_id", context.accountId)');
    expect(dashboard).toContain("queueCounts");
  });

  it("mantém rotas finas e regras de domínio fora da camada HTTP", () => {
    const route = read("web/app/api/campanhas/route.ts");
    const service = read("web/modules/campaigns/server/campaign-service.ts");
    expect(route).toContain("@/modules/campaigns/server/campaign-service");
    expect(route.split("\n").length).toBeLessThan(100);
    expect(service).toContain("export async function createCampaign");
    expect(service).toContain('.eq("account_id", accountId)');
  });
});
