import { describe, expect, it, vi } from "vitest";
import { cleanKeyword, distinctCategories, keywordOrFilter, nicheStoreCategories, recentSince } from "../modules/affiliate-catalog/server/catalog-filters";

type Call = { table: string; method: string; args: unknown[] };
const calls: Call[] = [];
const products = Array.from({ length: 2500 }, (_, index) => ({
  ml_item_id: `MLB${index}`, product_name: `Produto ${index}`, category: ["Acessórios para Veículos", "Agro", "Bebês", "Beleza e Cuidado Pessoal", "Pet Shop"][index % 5]
}));

// Banco falso: guarda as chamadas e devolve as linhas do intervalo pedido.
function builder(table: string) {
  let range: [number, number] = [0, 999];
  let onlyCategory = false;
  const chain: any = {};
  for (const method of ["eq", "gte", "lte", "not", "or", "in", "order", "ilike"]) chain[method] = (...args: unknown[]) => { calls.push({ table, method, args }); return chain; };
  chain.select = (columns: string) => { onlyCategory = columns === "category"; calls.push({ table, method: "select", args: [columns] }); return chain; };
  chain.range = (from: number, to: number) => { range = [from, to]; calls.push({ table, method: "range", args: [from, to] }); return chain; };
  chain.then = (resolve: (value: unknown) => void) => {
    const slice = products.slice(range[0], Math.min(range[1] + 1, range[0] + 1000));
    resolve({ data: onlyCategory ? slice.map(row => ({ category: row.category })) : slice, count: products.length, error: null });
  };
  return chain;
}
vi.mock("@/lib/supabase", () => ({ supabaseAdmin: () => ({ from: (table: string) => builder(table) }) }));

describe("filtros do catálogo guardado", () => {
  it("lista categorias distintas além das 1000 primeiras linhas", async () => {
    const pages: number[] = [];
    const rows = Array.from({ length: 2300 }, (_, index) => ({ category: index < 2000 ? "Agro" : "Beleza e Cuidado Pessoal" }));
    const categories = await distinctCategories(async (from, to) => { pages.push(from); return rows.slice(from, to + 1); });
    expect(categories).toEqual(["Agro", "Beleza e Cuidado Pessoal"]);
    expect(pages).toEqual([0, 1000, 2000]);
  });

  it("busca no nome ou na categoria, sem quebrar o filtro do PostgREST", () => {
    expect(keywordOrFilter("Beleza", "product_name")).toBe('product_name.ilike."%Beleza%",category.ilike."%Beleza%"');
    expect(cleanKeyword('fone, (bluetooth) "x"%_')).toBe("fone bluetooth x");
    expect(keywordOrFilter("  ,% ", "name")).toBeNull();
  });

  it("nicho da vitrine vira categorias das lojas, subnicho herda do pai", () => {
    expect(nicheStoreCategories("beleza")).toContain("Beleza e Cuidado Pessoal");
    expect(nicheStoreCategories("maquiagem", [{ id: "maquiagem", parentId: "beleza" }])).toContain("Beleza e Cuidado Pessoal");
    expect(nicheStoreCategories("viagem", [{ id: "viagem", parentId: null }])).toEqual([]);
  });

  it("catálogo do ML: só vistos em 7 dias, busca por categoria e todas as categorias", async () => {
    const { getStoredMercadoLivreCatalog } = await import("../modules/affiliate-catalog/server/mercado-livre-catalog-service");
    calls.length = 0;
    const result = await getStoredMercadoLivreCatalog({ keyword: "Beleza", listing: "top", page: 1, limit: 20 });
    expect(result.categories.map(category => category.label)).toContain("Beleza e Cuidado Pessoal");
    expect(result.categories).toHaveLength(6);
    const since = calls.filter(call => call.method === "gte" && call.args[0] === "last_seen_at");
    expect(since.length).toBeGreaterThanOrEqual(2);
    const sinceMs = Date.parse(String(since[0].args[1]));
    expect(Math.abs(sinceMs - Date.parse(recentSince(7)))).toBeLessThan(60_000);
    expect(calls.some(call => call.method === "or" && String(call.args[0]).includes('category.ilike."%Beleza%"'))).toBe(true);
    expect(calls.some(call => call.method === "ilike")).toBe(false);
  });
});
