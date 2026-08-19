import { describe, expect, it } from "vitest";
import { withAuthRetry } from "../modules/affiliate-catalog/server/mercado-livre-auth-retry";

function hooks() {
  const calls = { refresh: 0, markReauthRequired: 0 };
  return {
    calls,
    refresh: async () => { calls.refresh += 1; },
    markReauthRequired: async () => { calls.markReauthRequired += 1; }
  };
}

describe("mercado-livre-auth-retry", () => {
  it("devolve o resultado direto quando run() dá certo de primeira", async () => {
    const h = hooks();
    const result = await withAuthRetry(async () => "ok", h);
    expect(result).toBe("ok");
    expect(h.calls.refresh).toBe(0);
    expect(h.calls.markReauthRequired).toBe(0);
  });

  it("renova uma vez e tenta de novo quando run() falha com MERCADO_LIVRE_AUTH", async () => {
    const h = hooks();
    let attempts = 0;
    const result = await withAuthRetry(async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("MERCADO_LIVRE_AUTH");
      return "ok-depois-do-refresh";
    }, h);
    expect(result).toBe("ok-depois-do-refresh");
    expect(h.calls.refresh).toBe(1);
    expect(h.calls.markReauthRequired).toBe(0);
  });

  it("marca reautorização necessária quando falha de novo após o refresh", async () => {
    const h = hooks();
    await expect(withAuthRetry(async () => { throw new Error("MERCADO_LIVRE_AUTH"); }, h))
      .rejects.toThrow("MERCADO_LIVRE_REAUTHORIZATION_REQUIRED");
    expect(h.calls.refresh).toBe(1);
    expect(h.calls.markReauthRequired).toBe(1);
  });

  it("deixa passar direto um erro que não é de autenticação, sem chamar refresh", async () => {
    const h = hooks();
    await expect(withAuthRetry(async () => { throw new Error("MERCADO_LIVRE_RATE_LIMIT"); }, h))
      .rejects.toThrow("MERCADO_LIVRE_RATE_LIMIT");
    expect(h.calls.refresh).toBe(0);
    expect(h.calls.markReauthRequired).toBe(0);
  });
});
