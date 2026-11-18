import { afterAll, describe, expect, it, vi } from "vitest";
import type { FakePostgrest } from "./helpers/fake-postgrest.js";

// Mesmos tempos da produção (DB_TIMEOUT_MS 10 s, política padrão): a leitura
// esgotada termina antes do prazo de envio (SEND_TIMEOUT_MS 30 s), para o envio
// ser classificado pela própria falha de chave e não por tempo esgotado.
const shared = vi.hoisted(() => {
  delete process.env.DB_TIMEOUT_MS;
  delete process.env.SEND_TIMEOUT_MS;
  return { fake: null as unknown as FakePostgrest };
});

vi.mock("../supabase.js", async () => {
  const { createClient } = await import("@supabase/supabase-js");
  const { startFakePostgrest } = await import("./helpers/fake-postgrest.js");
  shared.fake = await startFakePostgrest();
  return { supabase: createClient(shared.fake.url, "chave-de-teste", { auth: { persistSession: false, autoRefreshToken: false } }) };
});

const { useSupabaseAuthState } = await import("../auth/supabase-auth-state.js");
const { env } = await import("../env.js");

afterAll(async () => { await shared.fake.close(); });

describe("tempos de produção", () => {
  it("timeout persistente e 521 persistente terminam antes do prazo do envio", async () => {
    expect(env.DB_TIMEOUT_MS).toBe(10_000);
    expect(env.SEND_TIMEOUT_MS).toBe(30_000);
    const results: Record<string, { attempts: number; ms: number }> = {};
    for (const mode of ["hang", "521"] as const) {
      const session = `prod-${mode}`;
      shared.fake.setMode(session, mode);
      const auth = await useSupabaseAuthState(session, "conta-teste", { onKeysUnavailable: () => undefined });
      const started = Date.now();
      await expect(auth.state.keys.get("session", ["5511.0"])).rejects.toMatchObject({ code: "AUTH_KEYS_UNAVAILABLE" });
      results[mode] = { attempts: shared.fake.keyReads(session).length, ms: Date.now() - started };
    }
    console.info({ event: "teste.tempos_producao", ...results });
    expect(results.hang.attempts).toBe(2);
    expect(results.hang.ms).toBeLessThan(env.SEND_TIMEOUT_MS - 5_000);
    expect(results["521"].attempts).toBe(4);
    expect(results["521"].ms).toBeLessThan(10_000);
  }, 60_000);
});
