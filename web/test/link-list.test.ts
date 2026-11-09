import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { extractProductLinks, LIST_MAX_LINKS, linkKey, listSlots, nameFromUrl, productIdFromUrl, storeOf } from "../modules/affiliate-catalog/link-list";
import { brasiliaTime } from "../modules/affiliate-catalog/schedule-plan";
import { bulkScheduleSchema } from "../modules/affiliate-catalog/schemas";
import { resolveStoreShortLink } from "../modules/affiliate-catalog/server/store-short-link";

const mocks = vi.hoisted(() => ({ guard: vi.fn(), context: vi.fn(), enabled: vi.fn(), resolve: vi.fn() }));
vi.mock("@/lib/security", () => ({ guardAdminMutation: mocks.guard, requireAccountContext: mocks.context }));
vi.mock("@/modules/affiliate-catalog/server/catalog-agenda-service", () => ({ isCatalogAgendaEnabled: mocks.enabled }));
vi.mock("@/modules/affiliate-catalog/server/link-list-service", () => ({ resolveListLink: mocks.resolve }));
import { POST } from "../app/api/catalogo/lista/route";

describe("lista de links: leitura do texto colado", () => {
  it("acha links um por linha e no meio da copy, sem pontuação grudada", () => {
    const text = "🔥 Oferta! https://shopee.com.br/Fone-Bluetooth-i.123.456?sp_atk=x.\n*https://www.mercadolivre.com.br/creatina/p/MLB18725310*\namzn.to/3abcDEF, e magazinevoce.com.br/magazineana/tv/p/abc1234567/";
    expect(extractProductLinks(text).links).toEqual([
      "https://shopee.com.br/Fone-Bluetooth-i.123.456?sp_atk=x",
      "https://www.mercadolivre.com.br/creatina/p/MLB18725310",
      "https://amzn.to/3abcDEF",
      "https://magazinevoce.com.br/magazineana/tv/p/abc1234567/"
    ]);
  });

  it("conta uma vez o mesmo produto com endereços diferentes", () => {
    const result = extractProductLinks([
      "https://shopee.com.br/Fone-i.123.456",
      "https://shopee.com.br/product/123/456?utm_source=zap",
      "https://www.amazon.com.br/Nome/dp/B0ABCDEFGH?tag=outra-20",
      "https://amazon.com.br/dp/B0ABCDEFGH",
      "https://amzn.to/xyz", "https://amzn.to/xyz"
    ].join("\n"));
    expect(result.links).toHaveLength(3);
    expect(result.repeated).toBe(3);
  });

  it(`para em ${LIST_MAX_LINKS} links e conta o que ficou de fora`, () => {
    const text = Array.from({ length: 53 }, (_, i) => `https://shopee.com.br/product/1/${1000 + i}`).join(" ");
    const result = extractProductLinks(text);
    expect(result.links).toHaveLength(LIST_MAX_LINKS);
    expect(result.overLimit).toBe(3);
  });

  it("reconhece as lojas e ignora o resto", () => {
    expect(storeOf("https://s.shopee.com.br/abc")).toBe("SHOPEE");
    expect(storeOf("https://meli.la/1x")).toBe("MERCADO_LIVRE");
    expect(storeOf("https://a.co/d/xyz")).toBe("AMAZON");
    expect(storeOf("https://www.magazineluiza.com.br/x/p/abc123/")).toBe("MAGALU");
    expect(storeOf("https://evil-shopee.com.br.attacker.io/x")).toBeNull();
    expect(storeOf("https://example.com/p/1")).toBeNull();
  });

  it("tira o código do produto e um nome provisório do endereço", () => {
    expect(productIdFromUrl("MERCADO_LIVRE", "https://www.mercadolivre.com.br/x/p/MLB1?pdp_filters=item_id%3AMLB6713010960")).toBe("MLB6713010960");
    expect(productIdFromUrl("MERCADO_LIVRE", "https://produto.mercadolivre.com.br/MLB-123456789-fone-_JM")).toBe("MLB123456789");
    expect(productIdFromUrl("AMAZON", "https://www.amazon.com.br/x/dp/b0abcdefgh")).toBe("B0ABCDEFGH");
    expect(linkKey(new URL("https://shopee.com.br/product/9/77"))).toBe("SHOPEE:77");
    expect(nameFromUrl("SHOPEE", "https://shopee.com.br/Fone-Bluetooth-X-i.1.2")).toBe("Fone bluetooth x");
    expect(nameFromUrl("MERCADO_LIVRE", "https://www.mercadolivre.com.br/creatina-1kg-pura/p/MLB18725310")).toBe("Creatina 1kg pura");
    expect(nameFromUrl("AMAZON", "https://amazon.com.br/dp/B0ABCDEFGH")).toBeNull();
  });
});

describe("lista de links: horários", () => {
  it("agora começa em 1 minuto e espaça pelo intervalo", () => {
    const now = new Date("2026-11-06T10:00:20-03:00");
    expect(listSlots(3, { mode: "now" }, 15, now).map(brasiliaTime)).toEqual(["10:02", "10:17", "10:32"]);
  });
  it("horário escolhido no futuro é respeitado; no passado vira agora + 5 min", () => {
    const now = new Date("2026-11-06T10:00:00-03:00");
    expect(listSlots(2, { mode: "at", day: "2026-11-06", time: "14:00" }, 30, now).map(brasiliaTime)).toEqual(["14:00", "14:30"]);
    expect(listSlots(2, { mode: "at", day: "2026-11-06", time: "08:00" }, 10, now).map(brasiliaTime)).toEqual(["10:05", "10:15"]);
    expect(listSlots(0, { mode: "now" }, 10, now)).toEqual([]);
  });
});

describe("lista de links: link curto", () => {
  const publicDns = async () => [{ address: "23.1.2.3" }];
  const redirect = (location: string) => new Response(null, { status: 302, headers: { location } });
  it("segue o encurtador até o produto da mesma loja", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(redirect("https://shopee.com.br/product/1/2?smtt=x"));
    const url = await resolveStoreShortLink("https://s.shopee.com.br/abc", "SHOPEE", { fetcher: fetcher as any, lookupHost: publicDns });
    expect(url.toString()).toBe("https://shopee.com.br/product/1/2?smtt=x");
  });
  it("recusa redirecionamento para fora da loja e rede privada", async () => {
    const away = vi.fn().mockResolvedValueOnce(redirect("https://example.com/x"));
    await expect(resolveStoreShortLink("https://meli.la/abc", "MERCADO_LIVRE", { fetcher: away as any, lookupHost: publicDns })).rejects.toThrow("fora da loja");
    const never = vi.fn();
    await expect(resolveStoreShortLink("https://meli.la/abc", "MERCADO_LIVRE", { fetcher: never as any, lookupHost: async () => [{ address: "10.0.0.5" }] })).rejects.toThrow("não permitido");
    expect(never).not.toHaveBeenCalled();
  });
  it("para em 5 saltos", async () => {
    const loop = vi.fn().mockImplementation(async () => redirect("https://meli.la/again"));
    await expect(resolveStoreShortLink("https://meli.la/abc", "MERCADO_LIVRE", { fetcher: loop as any, lookupHost: publicDns })).rejects.toThrow("demais");
    expect(loop).toHaveBeenCalledTimes(5);
  });
});

describe("lista de links: agendamento com mensagem editada", () => {
  const offer = { provider: "SHOPEE", externalItemId: "1", name: "Fone", affiliateUrl: "https://s.shopee.com.br/abc" };
  it("aceita mensagem opcional por oferta", () => {
    const base = { senderId: "11111111-1111-4111-8111-111111111111", groupJids: ["1@g.us"] };
    expect(bulkScheduleSchema.safeParse({ ...base, items: [{ offer, scheduledAt: "2026-11-06T10:00:00-03:00", message: "Olha isso https://s.shopee.com.br/abc" }] }).success).toBe(true);
    expect(bulkScheduleSchema.safeParse({ ...base, items: [{ offer, scheduledAt: "2026-11-06T10:00:00-03:00" }] }).success).toBe(true);
    expect(bulkScheduleSchema.safeParse({ ...base, items: [{ offer, scheduledAt: "2026-11-06T10:00:00-03:00", message: "   " }] }).success).toBe(false);
  });
});

describe("POST /api/catalogo/lista", () => {
  const request = (body: unknown) => new NextRequest("https://example.com/api/catalogo/lista", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.guard.mockResolvedValue(null);
    mocks.context.mockResolvedValue({ accountId: "account-a", database: {}, session: { userId: "u" } });
    mocks.enabled.mockResolvedValue(true);
    mocks.resolve.mockImplementation(async (_db: unknown, _account: string, input: string) => ({ input, status: "error", store: null, error: "x" }));
  });
  it("usa a conta da sessão, nunca do corpo", async () => {
    const response = await POST(request({ links: ["https://shopee.com.br/product/1/2"], accountId: "account-b" }));
    expect(response.status).toBe(200);
    expect(mocks.resolve).toHaveBeenCalledWith({}, "account-a", "https://shopee.com.br/product/1/2");
    expect((await response.json()).items).toHaveLength(1);
  });
  it("recusa lote grande, vazio ou corpo inválido", async () => {
    expect((await POST(request({ links: Array.from({ length: 5 }, (_, i) => `https://shopee.com.br/product/1/${i}`) }))).status).toBe(400);
    expect((await POST(request({ links: [] }))).status).toBe(400);
    expect((await POST(request("nada"))).status).toBe(400);
    expect(mocks.resolve).not.toHaveBeenCalled();
  });
  it("bloqueia conta sem a Agenda liberada", async () => {
    mocks.enabled.mockResolvedValue(false);
    expect((await POST(request({ links: ["https://shopee.com.br/product/1/2"] }))).status).toBe(403);
  });
  it("respeita a proteção da rota", async () => {
    mocks.guard.mockResolvedValue(new Response(null, { status: 429 }));
    expect((await POST(request({ links: ["https://shopee.com.br/product/1/2"] }))).status).toBe(429);
    expect(mocks.context).not.toHaveBeenCalled();
  });
});
