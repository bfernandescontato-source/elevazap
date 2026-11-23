import { afterEach, describe, expect, it, vi } from "vitest";

const imported: number[] = [];
vi.mock("@/lib/integration-crypto", () => ({ decryptIntegrationSecret: () => JSON.stringify({ ssid: "s", other: "x" }) }));
vi.mock("../modules/affiliate-catalog/server/mercado-livre-catalog-service", () => ({
  importMercadoLivreExtensionProducts: vi.fn(async (products: unknown[]) => { imported.push(products.length); return { received: products.length, inserted: products.length, updated: 0, errors: 0 }; })
}));

const storeUpdates: Array<{ filters: Array<[string, string, unknown]> }> = [];
vi.mock("@/lib/supabase", () => ({
  supabaseAdmin: () => ({
    from: () => {
      const filters: Array<[string, string, unknown]> = [];
      const chain: any = {
        upsert: async () => ({ error: null }),
        update: () => { storeUpdates.push({ filters }); return chain; },
        eq: (column: string, value: unknown) => { filters.push(["eq", column, value]); return chain; },
        lt: (column: string, value: unknown) => { filters.push(["lt", column, value]); return chain; },
        then: (resolve: (value: unknown) => void) => resolve({ error: null })
      };
      return chain;
    }
  })
}));

const database = { from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { encrypted_session_cookies: "v1.x.y.z" }, error: null }) }) }) }) }) };

// Central falsa: 2 categorias; cada página traz 18 produtos novos até o offset 54.
function hubCard(id: string, commission = true) {
  return { metadata: { id, url: `produto.mercadolivre.com.br/${id}` }, components: [{ id: "title", title: { text: `Produto ${id}` } }, ...(commission ? [{ id: "affiliates_commission_chip", chip: { pill: { text: "GANHOS 10%" } } }] : [])], pictures: { pictures: [{ id: "PIC" }] } };
}
function fakeHub(options: { commission?: boolean; status?: number } = {}) {
  const calls: Array<Record<string, any>> = [];
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
    const body = init.body ? JSON.parse(String(init.body)) : {};
    calls.push(body);
    if (options.status) return new Response("{}", { status: options.status });
    const category = body.filters?.[0]?.value || "BASE";
    const offset = body.offset || 0;
    const cards = offset >= 54 ? [] : Array.from({ length: 18 }, (_, index) => hubCard(`${category}-${offset + index}`, options.commission !== false));
    return new Response(JSON.stringify({
      polycard_client_model: { polycards: cards },
      filters: [{ id: "category", values: [{ id: "MLB1", name: "Beleza" }, { id: "MLB2", name: "Pet" }] }],
      next_offset: offset + 18
    }), { status: 200 });
  }));
  return calls;
}

afterEach(() => { vi.unstubAllGlobals(); imported.length = 0; storeUpdates.length = 0; });

describe("coleta da central de afiliados do ML", () => {
  it("coleta leve (extensão) faz 1 página por categoria, como antes", async () => {
    const calls = fakeHub();
    const { syncMercadoLivreHub } = await import("../modules/affiliate-catalog/server/mercado-livre-hub-service");
    const result = await syncMercadoLivreHub(database, "conta");
    expect(calls).toHaveLength(3);
    expect(calls.some(call => call.offset)).toBe(false);
    expect(result.received).toBe(54);
  });

  it("coleta do servidor pagina cada categoria pelo offset e importa em lotes", async () => {
    const calls = fakeHub();
    const { syncMercadoLivreHub } = await import("../modules/affiliate-catalog/server/mercado-livre-hub-service");
    const result = await syncMercadoLivreHub(database, "conta", { pagesPerCategory: 4, delayMs: 0 });
    // base + 2 categorias x 4 páginas (a 4ª volta vazia e encerra)
    expect(calls).toHaveLength(9);
    expect(calls.filter(call => call.filters?.[0]?.value === "MLB1").map(call => call.offset)).toEqual([undefined, 18, 36, 54]);
    expect(result.received).toBe(18 + 2 * 54);
    expect(result.chamadas).toBe(9);
  });

  it("sessão vencida (sem comissão ou 401) vira MERCADO_LIVRE_SESSION_EXPIRED", async () => {
    const { syncMercadoLivreHub } = await import("../modules/affiliate-catalog/server/mercado-livre-hub-service");
    fakeHub({ commission: false });
    await expect(syncMercadoLivreHub(database, "conta", { pagesPerCategory: 4, delayMs: 0 })).rejects.toThrow("MERCADO_LIVRE_SESSION_EXPIRED");
    fakeHub({ status: 401 });
    await expect(syncMercadoLivreHub(database, "conta", { pagesPerCategory: 4, delayMs: 0 })).rejects.toThrow("MERCADO_LIVRE_SESSION_EXPIRED");
    expect(imported).toEqual([]);
  });
});

describe("ofertas de Amazon/Magalu", () => {
  it("nova coleta soma às anteriores e só expira o que ninguém viu em 24 h", async () => {
    const { importStoreOffers } = await import("../modules/affiliate-catalog/server/store-catalog-service");
    const before = Date.now();
    await importStoreOffers("AMAZON", [{ external_item_id: "A1", name: "Produto" } as any]);
    expect(storeUpdates).toHaveLength(1);
    const cutoff = storeUpdates[0].filters.find(([kind, column]) => kind === "lt" && column === "last_seen_at")?.[2] as string;
    const age = before - Date.parse(cutoff);
    expect(age).toBeGreaterThan(23.9 * 3_600_000);
    expect(age).toBeLessThan(24.1 * 3_600_000);
    expect(storeUpdates[0].filters).toContainEqual(["eq", "provider", "AMAZON"]);
  });
});
