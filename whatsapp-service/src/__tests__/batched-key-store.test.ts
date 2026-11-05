import { describe, expect, it, vi } from "vitest";
import { batchKeyStore } from "../auth/batched-key-store.js";

describe("leituras frias de chaves Signal", () => {
  it("transforma 10 mil leituras concorrentes ausentes em uma leitura agrupada", async () => {
    const get = vi.fn(async (_type: string, _ids: string[]) => ({}));
    const store = batchKeyStore({ get, set: async () => {} });
    const results = await Promise.all(Array.from({ length: 10_000 }, (_, i) => store.get("session", [`${i}.0`])));
    expect(get).toHaveBeenCalledTimes(1);
    expect(get.mock.calls[0]).toEqual(["session", Array.from({ length: 10_000 }, (_, i) => `${i}.0`)]);
    expect(results.every((result) => Object.keys(result).length === 0)).toBe(true);
  });
  it("não mistura tipos e entrega somente as chaves solicitadas", async () => {
    const get = vi.fn(async (_type: string, ids: string[]) => Object.fromEntries(ids.map(id => [id, id])));
    const store = batchKeyStore({ get, set: async () => {} });
    expect(await Promise.all([store.get("session", ["a"]), store.get("session", ["b", "a"]), store.get("pre-key", ["a"])]))
      .toEqual([{ a: "a" }, { a: "a", b: "b" }, { a: "a" }]);
    expect(get).toHaveBeenCalledTimes(2);
  });
  it("preserva a ordem leitura/gravação/leitura sem cachear ausência após uma gravação", async () => {
    const calls: string[] = [];
    let tail = Promise.resolve();
    const serial = <T>(op: () => T) => { const result = tail.then(op); tail = result.then(() => {}); return result; };
    const data: Record<string, string> = {};
    const store = batchKeyStore({
      get: (_type, ids) => serial(() => { calls.push("read"); return Object.fromEntries(ids.filter(id => id in data).map(id => [id, data[id]])); }),
      set: (rows) => serial(() => { calls.push("write"); Object.assign(data, rows); })
    });
    const before = store.get("session", ["a"]);
    const write = store.set({ a: "new" });
    const after = store.get("session", ["a"]);
    expect(await before).toEqual({});
    await write;
    expect(await after).toEqual({ a: "new" });
    expect(calls).toEqual(["read", "write", "read"]);
  });
  it("propaga falhas do banco para todos os leitores e permite recuperação", async () => {
    const get = vi.fn(async (_type: string, _ids: string[]) => ({})).mockRejectedValueOnce(new Error("database unavailable"));
    const store = batchKeyStore({ get, set: async () => {} });
    const outcomes = await Promise.allSettled([store.get("session", ["a"]), store.get("session", ["b"])]);
    expect(outcomes.every(x => x.status === "rejected")).toBe(true);
    expect(await store.get("session", ["a"])).toEqual({});
  });
});
