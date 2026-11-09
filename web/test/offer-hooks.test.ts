import { describe, expect, it, vi } from "vitest";
import { GENERAL_HOOKS, type OfferCopyFacts } from "@disparei/affiliate-links/offer-copy";
import { generateAiHook, hookNeedsSequence, normalizeHookText, selectOfferHook, systemHookPool, validateAiHook, type HookSettings } from "@disparei/affiliate-links/offer-hooks";
import { buildCatalogOfferMessage, catalogMessageRandom } from "../modules/affiliate-catalog/offer-message";
import { createHookSchema, hookSettingsSchema } from "../modules/offer-hooks/schemas";

const facts: OfferCopyFacts = { productName: "Fone Bluetooth X 5.3", priceFromCents: 11990, priceToCents: 5990, priceCondition: null, statedDiscountPercent: null, coupon: null, extraLines: [] };
const own = (mode: HookSettings["mode"], extra: Partial<HookSettings> = {}): HookSettings => ({ mode, hooks: ["UM 🔥", "DOIS 👀", "TRÊS ✨"], ...extra });
const offer = { provider: "SHOPEE" as const, externalItemId: "1", name: "Fone Bluetooth X", priceMin: 89.9, affiliateUrl: "https://s.shopee.com.br/abc" };

describe("escolha do gancho", () => {
  it("modo do sistema sorteia da lista aprovada", () => {
    expect(selectOfferHook({ mode: "system", hooks: ["MEU"] }, { shownPercent: 0, random: () => 0 })).toBe(GENERAL_HOOKS[0]);
    expect(systemHookPool(50).length).toBeGreaterThan(systemHookPool(0).length);
  });

  it("em ordem segue a lista e volta ao primeiro", () => {
    const hooks = [0, 1, 2, 3, 4].map(sequence => selectOfferHook(own("own_sequence"), { shownPercent: 0, sequence }));
    expect(hooks).toEqual(["UM 🔥", "DOIS 👀", "TRÊS ✨", "UM 🔥", "DOIS 👀"]);
    expect(hookNeedsSequence(own("own_sequence"))).toBe(true);
    expect(hookNeedsSequence(own("own_random"))).toBe(false);
  });

  it("em ordem misturando alterna meus e sistema", () => {
    const settings = own("own_sequence", { mixSystem: true });
    expect(selectOfferHook(settings, { shownPercent: 0, sequence: 0, random: () => 0 })).toBe("UM 🔥");
    expect(selectOfferHook(settings, { shownPercent: 0, sequence: 1, random: () => 0 })).toBe(GENERAL_HOOKS[0]);
    expect(selectOfferHook(settings, { shownPercent: 0, sequence: 2, random: () => 0 })).toBe("DOIS 👀");
  });

  it("sem contador, em ordem vira aleatório entre os meus", () => {
    expect(selectOfferHook(own("own_sequence"), { shownPercent: 0, sequence: null, random: () => 0.99 })).toBe("TRÊS ✨");
  });

  it("aleatório e fixo usam os ganchos do aluno", () => {
    expect(selectOfferHook(own("own_random"), { shownPercent: 0, random: () => 0.5 })).toBe("DOIS 👀");
    expect(selectOfferHook(own("fixed", { fixedHook: "SEMPRE ESSE 💥" }), { shownPercent: 0, random: () => 0 })).toBe("SEMPRE ESSE 💥");
  });

  it("sem ganchos do aluno cai na lista do sistema", () => {
    for (const mode of ["own_sequence", "own_random", "fixed", "ai"] as const) {
      expect(selectOfferHook({ mode, hooks: [] }, { shownPercent: 0, sequence: 3, random: () => 0 })).toBe(GENERAL_HOOKS[0]);
    }
  });

  it("fixo apagado cai nos outros ganchos do aluno", () => {
    expect(selectOfferHook(own("fixed", { fixedHook: null }), { shownPercent: 0, random: () => 0 })).toBe("UM 🔥");
  });

  it("IA usa o gancho validado e, sem ele, os do aluno", () => {
    expect(selectOfferHook(own("ai"), { shownPercent: 0, aiHook: "OLHA SÓ ISSO 😍", random: () => 0 })).toBe("OLHA SÓ ISSO 😍");
    expect(selectOfferHook(own("ai"), { shownPercent: 0, aiHook: null, random: () => 0 })).toBe("UM 🔥");
  });

  it("modo desconhecido vira sistema e gancho com link é ignorado", () => {
    expect(selectOfferHook({ mode: "xyz" as never, hooks: ["UM"] }, { shownPercent: 0, random: () => 0 })).toBe(GENERAL_HOOKS[0]);
    expect(normalizeHookText("veja https://x.com")).toBeNull();
    expect(normalizeHookText("dois\nlinhas")).toBeNull();
    expect(normalizeHookText("  ACHEI   AQUI  ")).toBe("ACHEI AQUI");
  });
});

describe("validação do gancho da IA", () => {
  it("aceita uma linha curta com emoji", () => {
    expect(validateAiHook("  \"CORRE QUE TÁ BARATO 🏃\"  ", facts)).toBe("CORRE QUE TÁ BARATO 🏃");
  });
  it("recusa várias linhas, texto longo, link e número fora da oferta", () => {
    expect(validateAiHook("LINHA UM\nLINHA DOIS", facts)).toBeNull();
    expect(validateAiHook("A".repeat(61), facts)).toBeNull();
    expect(validateAiHook("VEJA EM loja.com.br", facts)).toBeNull();
    expect(validateAiHook("70% OFF HOJE 🔥", facts)).toBeNull();
    expect(validateAiHook("SÓ R$ 9,90 🔥", facts)).toBeNull();
    expect(validateAiHook("🔥🔥", facts)).toBeNull();
    expect(validateAiHook(undefined, facts)).toBeNull();
  });
  it("aceita número que está na oferta", () => {
    expect(validateAiHook("50% MAIS BARATO 🔥", facts)).toBe("50% MAIS BARATO 🔥");
    expect(validateAiHook("SÓ R$59,90 HOJE", facts)).toBe("SÓ R$59,90 HOJE");
    expect(validateAiHook("FONE 5.3 DE RESPEITO", facts)).toBe("FONE 5.3 DE RESPEITO");
  });
});

describe("gancho com IA gratuita", () => {
  const reply = (content: string) => ({ ok: true, json: async () => ({ choices: [{ message: { content } }] }) });

  it("sem chave ou sem modelos não chama nada", async () => {
    const fetch = vi.fn();
    expect(await generateAiHook(facts, { apiKey: "", models: "a:free", fetch: fetch as never })).toBeNull();
    expect(await generateAiHook(facts, { apiKey: "k", models: "", fetch: fetch as never })).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("tenta o próximo modelo quando a saída é inválida ou dá erro", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce({ ok: false, json: async () => ({}) })
      .mockResolvedValueOnce(reply("Aqui está:\nPROMO 🔥"))
      .mockResolvedValueOnce(reply("ACHADO QUE VALE OURO ✨"));
    expect(await generateAiHook(facts, { apiKey: "k", models: "a:free,b:free,c:free", fetch: fetch as never })).toBe("ACHADO QUE VALE OURO ✨");
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(JSON.parse(fetch.mock.calls[0][1].body).model).toBe("a:free");
  });

  it("respeita o prazo e devolve null sem lançar erro", async () => {
    const fetch = vi.fn((_url: string, init: { signal: AbortSignal }) => new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(new Error("abort")))));
    const started = Date.now();
    expect(await generateAiHook(facts, { apiKey: "k", models: ["a:free", "b:free"], fetch: fetch as never, timeoutMs: 150 })).toBeNull();
    expect(Date.now() - started).toBeLessThan(1500);
  });

  it("nunca passa de 4 segundos mesmo pedindo mais", async () => {
    vi.useFakeTimers();
    try {
      const fetch = vi.fn((_url: string, init: { signal: AbortSignal }) => new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(new Error("abort")))));
      const pending = generateAiHook(facts, { apiKey: "k", models: ["a:free"], fetch: fetch as never, timeoutMs: 60_000 });
      await vi.advanceTimersByTimeAsync(4001);
      expect(await pending).toBeNull();
    } finally { vi.useRealTimers(); }
  });
});

describe("mensagem do Catálogo com ganchos da conta", () => {
  it("sem configuração continua igual ao modelo antigo", () => {
    const random = () => catalogMessageRandom(offer, "2026-10-06");
    expect(buildCatalogOfferMessage(offer, offer.affiliateUrl, random(), { settings: { mode: "system", hooks: [] } }))
      .toBe(buildCatalogOfferMessage(offer, offer.affiliateUrl, random()));
  });

  it("usa o gancho do aluno e a prévia bate com o servidor", () => {
    const settings = own("own_random");
    const preview = buildCatalogOfferMessage(offer, offer.affiliateUrl, catalogMessageRandom(offer, "2026-10-06"), { settings });
    const sent = buildCatalogOfferMessage(offer, offer.affiliateUrl, catalogMessageRandom(offer, "2026-10-06"), { settings });
    expect(preview).toBe(sent);
    expect(settings.hooks).toContain(preview.split("\n")[0]);
  });

  it("em ordem usa a posição reservada", () => {
    const message = buildCatalogOfferMessage(offer, offer.affiliateUrl, () => 0, { settings: own("own_sequence"), sequence: 2 });
    expect(message.split("\n")[0]).toBe("TRÊS ✨");
    expect(message).toContain("🛍️ Fone Bluetooth X");
  });
});

describe("validação da tela de ganchos", () => {
  it("limpa espaços e recusa link e texto longo", () => {
    expect(createHookSchema.parse({ text: "  OLHA  ISSO 🔥 " }).text).toBe("OLHA ISSO 🔥");
    expect(createHookSchema.safeParse({ text: "https://x.com" }).success).toBe(false);
    expect(createHookSchema.safeParse({ text: "A".repeat(81) }).success).toBe(false);
    expect(createHookSchema.safeParse({ text: "   " }).success).toBe(false);
  });
  it("fixo exige escolher o gancho", () => {
    expect(hookSettingsSchema.safeParse({ mode: "fixed", mixSystem: false, fixedHookId: null }).success).toBe(false);
    expect(hookSettingsSchema.safeParse({ mode: "own_sequence" }).success).toBe(true);
  });
});
