import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { FakePostgrest } from "./helpers/fake-postgrest.js";

// Leitura real de chaves (supabase-auth-state + batchKeyStore + cache do Baileys)
// com o supabase-js real falando HTTP com um PostgREST falso em 127.0.0.1.
const shared = vi.hoisted(() => {
  process.env.DB_TIMEOUT_MS = "1000";
  return { fake: null as unknown as FakePostgrest };
});

vi.mock("../supabase.js", async () => {
  const { createClient } = await import("@supabase/supabase-js");
  const { startFakePostgrest } = await import("./helpers/fake-postgrest.js");
  shared.fake = await startFakePostgrest();
  return { supabase: createClient(shared.fake.url, "chave-de-teste", { auth: { persistSession: false, autoRefreshToken: false } }) };
});

const { useSupabaseAuthState } = await import("../auth/supabase-auth-state.js");
const { AuthKeysUnavailableError, KEY_READ_POLICY, isTemporaryKeyReadError } = await import("../auth/key-read-guard.js");
const { isRecoveringAuthKeysRejection } = await import("../utils/baileys-rejections.js");
const { BufferJSON } = await import("@whiskeysockets/baileys");

Object.assign(KEY_READ_POLICY, { baseDelayMs: 100, budgetMs: 2_500, cooldownBaseMs: 400, cooldownMaxMs: 3_000 });
const fake = () => shared.fake;
let seq = 0;

async function authFor(prefix: string) {
  const session = `${prefix}-${++seq}`;
  const outages: InstanceType<typeof AuthKeysUnavailableError>[] = [];
  const auth = await useSupabaseAuthState(session, "conta-teste", { onKeysUnavailable: (error) => { outages.push(error); } });
  return { session, auth, outages, keys: auth.state.keys as any };
}

const keyData = (n: number) => JSON.parse(JSON.stringify({ keyPair: { public: Buffer.from([n]), private: Buffer.from([n, n]) } }, BufferJSON.replacer));
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

afterAll(async () => { await fake().close(); });

describe("classificação da falha de leitura", () => {
  it("521 da Cloudflare, 52x, tempo esgotado e rede são temporários; Bad Request não", () => {
    expect(isTemporaryKeyReadError(new Error("auth.keys.get:x: <!DOCTYPE html> ... Error code 521 ... Web server is down"))).toBe(true);
    expect(isTemporaryKeyReadError(new Error("auth.keys.get:x: error code: 522"))).toBe(true);
    expect(isTemporaryKeyReadError(Object.assign(new Error("auth.keys.get:x excedeu o limite de 10000 ms."), { code: "OPERATION_TIMEOUT" }))).toBe(true);
    expect(isTemporaryKeyReadError(new Error("TypeError: fetch failed"))).toBe(true);
    expect(isTemporaryKeyReadError(new Error("auth.keys.get:x: Bad Request"))).toBe(false);
    expect(isTemporaryKeyReadError(new Error("permission denied for table whatsapp_auth_keys"))).toBe(false);
  });

  it("o guarda global só deixa passar a falha de chave cujo número já está em recuperação", () => {
    const pending = new AuthKeysUnavailableError("n", 4, 1000);
    expect(isRecoveringAuthKeysRejection(pending)).toBe(false);
    pending.recoveryRequested = true;
    expect(isRecoveringAuthKeysRejection(pending)).toBe(true);
    expect(isRecoveringAuthKeysRejection(new Error("auth.keys.get:n: <!DOCTYPE html> Error code 521"))).toBe(false);
  });
});

describe("leitura de chaves com o banco instável (HTTP real, sem rede externa)", () => {
  beforeEach(() => { fake().requests.length = 0; });

  it("521 passageiro: repete a leitura e devolve a chave guardada", async () => {
    const { session, keys, outages } = await authFor("passageiro");
    fake().seedKey(session, "pre-key", "1", keyData(1));
    fake().script(session, "521");
    const rows = await keys.get("pre-key", ["1"]);
    expect(Buffer.from(rows["1"].keyPair.public)).toEqual(Buffer.from([1]));
    expect(fake().keyReads(session).map((r) => r.mode)).toEqual(["521", "ok"]);
    expect(outages).toHaveLength(0);
  });

  it("521 persistente: 4 tentativas espaçadas, erro tipado, nunca 'sem chaves', nada apagado", async () => {
    const { session, keys, outages } = await authFor("persistente");
    fake().seedKey(session, "pre-key", "1", keyData(1));
    fake().setMode(session, "521");
    const error = await keys.get("pre-key", ["1"]).then(() => null, (e: unknown) => e);
    expect(error).toBeInstanceOf(AuthKeysUnavailableError);
    expect(error).toMatchObject({ code: "AUTH_KEYS_UNAVAILABLE", attempts: 4, recoveryRequested: true });
    const reads = fake().keyReads(session);
    expect(reads).toHaveLength(4);
    const gaps = reads.slice(1).map((r, i) => r.at - reads[i].at);
    expect(gaps[0]).toBeGreaterThanOrEqual(70);   // 100 ms ±25%
    expect(gaps[1]).toBeGreaterThanOrEqual(145);  // 200 ms ±25%
    expect(gaps[2]).toBeGreaterThanOrEqual(295);  // 400 ms ±25%
    expect(outages).toHaveLength(1);
    expect(fake().destructive()).toHaveLength(0);
    expect(fake().keys.has(`${session}|pre-key|1`)).toBe(true);
  });

  it("durante a espera do número em recuperação, nova leitura falha na hora sem ir ao banco", async () => {
    const { session, keys } = await authFor("espera");
    fake().setMode(session, "521");
    await keys.get("pre-key", ["1"]).catch(() => undefined);
    const before = fake().keyReads(session).length;
    const started = Date.now();
    await expect(keys.get("pre-key", ["2"])).rejects.toMatchObject({ code: "AUTH_KEYS_UNAVAILABLE", attempts: 0 });
    expect(Date.now() - started).toBeLessThan(50);
    expect(fake().keyReads(session)).toHaveLength(before);
  });

  it("timeout persistente: tentativas limitadas pelo orçamento, termina antes do prazo do envio", async () => {
    const { session, keys, outages } = await authFor("timeout");
    fake().setMode(session, "hang");
    const started = Date.now();
    const error = await keys.get("session", ["5511.0"]).then(() => null, (e: unknown) => e);
    const elapsed = Date.now() - started;
    expect(error).toBeInstanceOf(AuthKeysUnavailableError);
    const attempts = fake().keyReads(session).length;
    expect(attempts).toBeGreaterThanOrEqual(2);
    expect(attempts).toBeLessThanOrEqual(KEY_READ_POLICY.maxAttempts);
    expect(elapsed).toBeLessThan(KEY_READ_POLICY.budgetMs + 1_000 + 500); // orçamento + uma tentativa + folga
    expect(outages).toHaveLength(1);
  });

  it("recuperação: depois da espera o banco volta e a leitura funciona; a espera seguinte recomeça do mínimo", async () => {
    const { session, keys, outages } = await authFor("recupera");
    fake().seedKey(session, "pre-key", "7", keyData(7));
    fake().setMode(session, "521");
    await keys.get("pre-key", ["7"]).catch(() => undefined);
    fake().setMode(session, "521");
    await sleep(outages[0].cooldownMs + 20);
    await keys.get("pre-key", ["8"]).catch(() => undefined);
    expect(outages[1].cooldownMs).toBe(outages[0].cooldownMs * 2); // segunda queda seguida: espera dobra
    fake().setMode(session, "ok");
    await sleep(outages[1].cooldownMs + 20);
    const rows = await keys.get("pre-key", ["7"]);
    expect(Buffer.from(rows["7"].keyPair.public)).toEqual(Buffer.from([7]));
    fake().setMode(session, "521");
    await keys.get("pre-key", ["9"]).catch(() => undefined);
    expect(outages[2].cooldownMs).toBe(KEY_READ_POLICY.cooldownBaseMs);
  });

  it("leitura em lotes: um lote falho rejeita tudo, sem resultado parcial", async () => {
    const { session, keys } = await authFor("lotes");
    const ids = Array.from({ length: 150 }, (_, i) => String(i));
    for (const id of ids) fake().seedKey(session, "pre-key", id, keyData(Number(id) % 250));
    fake().script(session, "ok", "521", "521", "521", "521");
    await expect(keys.get("pre-key", ids)).rejects.toMatchObject({ code: "AUTH_KEYS_UNAVAILABLE" });
    expect(fake().keyReads(session).map((r) => r.keyIds.length)).toEqual([100, 50, 50, 50, 50]);
  });

  it("isolando chave malformada (400), uma falha de infraestrutura no meio rejeita em vez de virar chave ausente", async () => {
    const { session, keys } = await authFor("malformada");
    fake().seedKey(session, "pre-key", "1", keyData(1));
    fake().seedKey(session, "pre-key", "2", keyData(2));
    fake().script(session, "400", "521", "521", "521", "521");
    await expect(keys.get("pre-key", ["1", "2"])).rejects.toMatchObject({ code: "AUTH_KEYS_UNAVAILABLE" });
  });

  it("chave malformada sozinha continua tratada como ausente (comportamento anterior)", async () => {
    const { session, keys, outages } = await authFor("so-malformada");
    fake().script(session, "400");
    await expect(keys.get("pre-key", ["1"])).resolves.toEqual({});
    expect(outages).toHaveLength(0);
  });
});
