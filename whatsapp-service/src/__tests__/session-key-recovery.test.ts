import { EventEmitter } from "node:events";
import { afterAll, describe, expect, it, vi } from "vitest";
import type { FakePostgrest } from "./helpers/fake-postgrest.js";

// Sessão real (whatsapp/session.ts) e leitura real de chaves; só o socket do
// Baileys é simulado, para nada conectar ao WhatsApp.
const shared = vi.hoisted(() => {
  process.env.DB_TIMEOUT_MS = "1000";
  return { fake: null as unknown as FakePostgrest, sockets: [] as any[] };
});

vi.mock("../supabase.js", async () => {
  const { createClient } = await import("@supabase/supabase-js");
  const { startFakePostgrest } = await import("./helpers/fake-postgrest.js");
  shared.fake = await startFakePostgrest();
  return { supabase: createClient(shared.fake.url, "chave-de-teste", { auth: { persistSession: false, autoRefreshToken: false } }) };
});
vi.mock("../utils/baileys-version.js", () => ({ getBaileysVersion: async () => [2, 3000, 1] }));
vi.mock("@whiskeysockets/baileys", async (original) => {
  const real: any = await original();
  const { pino } = await import("pino");
  const makeWASocket = (config: any) => {
    const ev = new EventEmitter();
    const ws = Object.assign(new EventEmitter(), { isOpen: true });
    const sock: any = {
      config, ev, ws, user: { id: "5500000000000:1@s.whatsapp.net" },
      // Igual ao makeWASocket: chaves com transação por cima do armazenamento da sessão.
      keys: real.addTransactionCapability(config.auth.keys, pino({ level: "silent" }), { maxCommitRetries: 10, delayBetweenTriesMs: 3000 }),
      log: [] as string[],
      end: vi.fn((error?: Error) => {
        sock.log.push("end");
        if (!ws.isOpen) return; // como o Baileys: socket já fechado não emite outro "close"
        ws.isOpen = false;
        ev.emit("connection.update", { connection: "close", lastDisconnect: { error, date: new Date() } });
      }),
      logout: vi.fn(async () => undefined),
      sendMessage: vi.fn(async () => ({ key: { id: "WA-x" } }))
    };
    shared.sockets.push(sock);
    return sock;
  };
  return { ...real, default: makeWASocket };
});

const { createWhatsAppSession } = await import("../whatsapp/session.js");
const { KEY_READ_POLICY } = await import("../auth/key-read-guard.js");
const { makeMutex } = await import("@whiskeysockets/baileys/lib/Utils/make-mutex.js" as any);

Object.assign(KEY_READ_POLICY, { baseDelayMs: 50, budgetMs: 1_000, cooldownBaseMs: 600, cooldownMaxMs: 2_000 });
const fake = () => shared.fake;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const socketsOf = (session: string) => shared.sockets.filter((s) => s.config.auth === sessions.get(session)?.authState);
const sessions = new Map<string, { authState: any }>();

async function openSession(name: string) {
  const before = shared.sockets.length;
  const session = await createWhatsAppSession(name, async () => undefined, undefined, "conta-teste");
  const sock = shared.sockets[before];
  sessions.set(name, { authState: sock.config.auth });
  sock.ev.emit("connection.update", { connection: "open" });
  await sleep(10);
  return { session, sock };
}

afterAll(async () => { await fake().close(); });

describe("número em recuperação quando a leitura de chaves esgota", () => {
  it("fecha só o socket do número A, sem logout, sem limpar chaves, sem QR; B segue conectado e lendo chaves", async () => {
    const a = await openSession("numero-a");
    const b = await openSession("numero-b");
    expect(a.session.getStatus()).toBe("connected");
    fake().seedKey("numero-b", "session", "5511.0", { ok: true });
    fake().setMode("numero-a", "521");

    // Mesmo formato do Baileys em messages-recv (retryMutex.mutex sem await):
    // o pedido de reenvio lê chaves dentro de uma transação.
    const unawaited = makeMutex().mutex(async () => a.sock.keys.transaction(() => a.sock.keys.get("session", ["5511.0"])));
    const rejection = await unawaited.then(() => null, (error: unknown) => { a.sock.log.push("rejected"); return error; });

    expect(rejection).toMatchObject({ code: "AUTH_KEYS_UNAVAILABLE", recoveryRequested: true });
    expect(a.sock.log).toEqual(["end", "rejected"]); // socket fechado antes da rejeição: Baileys não manda reenvio
    expect(a.sock.end).toHaveBeenCalledTimes(1);
    expect(a.sock.end.mock.calls[0][0]).toMatchObject({ output: { statusCode: 503 } });
    expect(a.sock.logout).not.toHaveBeenCalled();
    expect(a.session.getStatus()).toBe("reconnecting");
    expect(a.session.getLastError()).toMatch(/sem novo QR/);
    expect(a.session.getQr()).toBe("");
    expect(fake().destructive()).toHaveLength(0);

    // Várias leituras falhando ao mesmo tempo não multiplicam a recuperação.
    await Promise.allSettled([a.sock.keys.get("session", ["1.0"]), a.sock.keys.get("session", ["2.0"])]);
    expect(a.sock.end).toHaveBeenCalledTimes(1);

    // B não foi tocado e lê chaves normalmente durante a falha de A.
    expect(b.sock.end).not.toHaveBeenCalled();
    expect(b.session.getStatus()).toBe("connected");
    await expect(b.sock.keys.get("session", ["5511.0"])).resolves.toEqual({ "5511.0": { ok: true } });

    // Depois da espera, A reconecta com as mesmas credenciais (mesmo estado de auth, sem QR).
    fake().setMode("numero-a", "ok");
    await sleep(rejection && (rejection as any).cooldownMs + 150);
    const reconnected = socketsOf("numero-a");
    expect(reconnected).toHaveLength(2);
    expect(reconnected[1].config.auth).toBe(reconnected[0].config.auth);
    reconnected[1].ev.emit("connection.update", { connection: "open" });
    await sleep(10);
    expect(a.session.getStatus()).toBe("connected");
    await expect(reconnected[1].keys.get("pre-key", ["1"])).resolves.toEqual({});
    expect(fake().destructive()).toHaveLength(0);

    await a.session.stop();
    await b.session.stop();
  });
});
