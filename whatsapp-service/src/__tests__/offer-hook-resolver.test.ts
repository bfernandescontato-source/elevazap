import { describe, expect, it, vi } from "vitest";
import { OfferHookResolver } from "../offers/offer-hook-resolver.js";
import { OfferAiRewriter } from "../offers/offer-ai-rewriter.js";
import { GENERAL_HOOKS, type OfferCopyFacts } from "../offers/offer-copy-template.js";
import { createOpenRouterExtractionClient } from "../offers/openrouter-extraction-client.js";

const facts: OfferCopyFacts = { productName: "Fone X", priceFromCents: null, priceToCents: 5000, priceCondition: null, statedDiscountPercent: null, coupon: null, extraLines: [] };

function fakeDatabase(settings: Record<string, unknown> | null, hooks: Array<{ id: string; text: string }>, options: { fail?: boolean } = {}) {
  let counter = 0;
  const calls = { settings: 0, rpc: 0 };
  const query = (table: string) => {
    const result = () => {
      if (options.fail) return { data: null, error: new Error("down") };
      if (table === "account_offer_hook_settings") { calls.settings++; return { data: settings, error: null }; }
      return { data: hooks, error: null };
    };
    const builder: any = { select: () => builder, eq: () => builder, order: () => builder, limit: () => Promise.resolve(result()), maybeSingle: () => Promise.resolve(result()) };
    return builder;
  };
  return {
    calls,
    database: {
      from: query,
      rpc: vi.fn(async () => { calls.rpc++; return { data: counter++, error: null }; })
    } as any
  };
}

describe("gancho do Piloto por conta", () => {
  it("sem configuração devolve undefined (lista do sistema)", async () => {
    const { database } = fakeDatabase(null, []);
    expect(await new OfferHookResolver(database).hookFor("acc", facts)).toBeUndefined();
  });

  it("em ordem avança o contador da conta a cada oferta", async () => {
    const { database, calls } = fakeDatabase({ mode: "own_sequence", mix_system: false, fixed_hook_id: null }, [{ id: "1", text: "UM" }, { id: "2", text: "DOIS" }]);
    const resolver = new OfferHookResolver(database);
    const hooks = [];
    for (let i = 0; i < 3; i++) hooks.push(await resolver.hookFor("acc", facts));
    expect(hooks).toEqual(["UM", "DOIS", "UM"]);
    expect(calls.rpc).toBe(3);
    // Configuração em cache: uma leitura só.
    expect(calls.settings).toBe(1);
  });

  it("cache expira depois de 1 minuto", async () => {
    let now = 0;
    const { database, calls } = fakeDatabase({ mode: "fixed", mix_system: false, fixed_hook_id: "2" }, [{ id: "1", text: "UM" }, { id: "2", text: "DOIS" }]);
    const resolver = new OfferHookResolver(database, {}, () => now);
    expect(await resolver.hookFor("acc", facts)).toBe("DOIS");
    now = 30_000; await resolver.hookFor("acc", facts);
    expect(calls.settings).toBe(1);
    now = 61_000; await resolver.hookFor("acc", facts);
    expect(calls.settings).toBe(2);
  });

  it("banco fora do ar não quebra: volta para o sistema", async () => {
    const { database } = fakeDatabase(null, [], { fail: true });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(await new OfferHookResolver(database).hookFor("acc", facts)).toBeUndefined();
    warn.mockRestore();
  });

  it("IA que falha cai nos ganchos do aluno", async () => {
    const { database } = fakeDatabase({ mode: "ai", mix_system: false, fixed_hook_id: null }, [{ id: "1", text: "MEU GANCHO" }]);
    const generate = vi.fn(async () => { throw new Error("sem cota"); });
    expect(await new OfferHookResolver(database, { apiKey: "k", models: "a:free" }, Date.now, generate as never).hookFor("acc", facts)).toBe("MEU GANCHO");
    const ok = vi.fn(async () => "GANCHO DA IA ✨");
    expect(await new OfferHookResolver(database, { apiKey: "k", models: "a:free" }, Date.now, ok as never).hookFor("acc", facts)).toBe("GANCHO DA IA ✨");
  });

  it("o rewriter usa o gancho da conta na copy", async () => {
    const client = { responses: { create: async () => ({ status: "completed", output_text: JSON.stringify({ product_name: "Fone X", price_from: null, price_to: "R$ 50,00", price_condition: null, discount_percent: null, coupon: null, extra_lines: [] }) }) } } as never;
    const link = "https://s.shopee.com.br/abc";
    const text = "Fone X por R$ 50,00 " + link;
    const withHook = await new OfferAiRewriter(undefined, "gpt-test", client, () => 0).rewrite({ text, purchaseLink: link, links: [], hookFor: async () => "MEU GANCHO 🔥" });
    expect(withHook.text.split("\n")[0]).toBe("MEU GANCHO 🔥");
    const failing = await new OfferAiRewriter(undefined, "gpt-test", client, () => 0).rewrite({ text, purchaseLink: link, links: [], hookFor: async () => { throw new Error("x"); } });
    expect(failing.text.split("\n")[0]).toBe(GENERAL_HOOKS[0]);
  });
});

describe("extração pelo OpenRouter gratuito", () => {
  const params = { input: [{ role: "system", content: "x" }, { role: "user", content: "oferta" }], text: { format: { schema: { properties: { product_name: {}, price_to: {} } } } } };

  it("pega o JSON da resposta e informa o modelo usado", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 429, json: async () => ({}) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ choices: [{ message: { content: "```json\n{\"product_name\":\"Fone\",\"price_to\":null}\n```" } }] }) });
    const client = createOpenRouterExtractionClient({ apiKey: "k", models: "a:free,b:free", fetch: fetch as never });
    const response = await client.responses.create(params);
    expect(JSON.parse(response.output_text)).toEqual({ product_name: "Fone", price_to: null });
    expect(response.model).toBe("openrouter:b:free");
    expect(JSON.parse(fetch.mock.calls[0][1].body).messages[0].content).toContain("product_name, price_to");
  });

  it("sem JSON em nenhum modelo, lança para o Piloto manter o texto original", async () => {
    const fetch = vi.fn(async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: "não sei" } }] }) }));
    const client = createOpenRouterExtractionClient({ apiKey: "k", models: ["a:free"], fetch: fetch as never });
    await expect(client.responses.create(params)).rejects.toThrow(/IA gratuita indisponível/);
  });
});
