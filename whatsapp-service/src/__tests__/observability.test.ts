import { EventEmitter } from "node:events";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  classifyDecryptError, NO_RAW_NO_INBOUND_UPSERT, observer as sharedObserver, parseSessionList, PROCESS_SESSION,
  RAW_SEEN_NO_INBOUND_UPSERT, SessionObserver, socketKey, type IncidentRow, type MinuteRow, type ObsPersistence
} from "../observability/observer.js";
import { createInstanceHooks, observabilityListenerCount } from "../observability/socket-hooks.js";

const CIPHERTEXT = 2;
const MINUTE = 60_000;

function setup(options: { sessions?: string[] | null; perHour?: number } = {}) {
  let now = Date.UTC(2026, 9, 7, 12, 0, 0);
  const minutes: MinuteRow[][] = [];
  const incidents: IncidentRow[] = [];
  const resolved: Array<{ id: string; silenceMs: number }> = [];
  const persistence: ObsPersistence = {
    writeMinutes: vi.fn(async (rows) => { minutes.push(rows); }),
    writeIncident: vi.fn(async (row) => { incidents.push(row); }),
    resolveIncident: vi.fn(async (id, _at, silenceMs) => { resolved.push({ id, silenceMs }); })
  };
  const logs: Record<string, unknown>[] = [];
  const observer = new SessionObserver({
    now: () => now, ringMinutes: 60, persistence, log: (entry) => logs.push(entry), enabled: true,
    sessions: options.sessions ?? null, limits: options.perHour ? { perHour: options.perHour } : undefined
  });
  return {
    observer, minutes, incidents, resolved, logs, persistence,
    advance: (ms: number) => { now += ms; },
    open: (session = "s1", instance = "inst-aaaaaaaa", seq = 1) => { observer.socketCreated(session, instance, seq, "acct"); observer.socketOpened(session, instance, seq); }
  };
}

const groupMessage = (fromMe = false, stub?: number, error?: string) => ({
  key: { remoteJid: "123@g.us", fromMe },
  ...(stub ? { messageStubType: stub, messageStubParameters: [error] } : {})
});
const rawGroup = { tag: "message", attrs: { from: "123@g.us" } };
const INST = "inst-aaaaaaaa";

describe("observabilidade: detector e rótulos", () => {
  it("marca o silêncio em 2, 5, 10 e 20 min com rótulo só observacional", async () => {
    const t = setup();
    t.open();
    t.observer.upsert("s1", "notify", [groupMessage()], CIPHERTEXT, INST, 1);
    t.observer.frame("s1", rawGroup, INST, 1);
    for (const step of [2, 3, 5, 10]) { t.advance(step * MINUTE); t.observer.tick(); }
    await Promise.resolve();
    const checkpoints = t.logs.filter((entry) => entry.event === "obs.silence_checkpoint");
    expect(checkpoints.map((entry) => entry.level_minutes)).toEqual([2, 5, 10, 20]);
    expect(checkpoints.every((entry) => entry.classification === RAW_SEEN_NO_INBOUND_UPSERT)).toBe(true);
    expect(checkpoints[0].delta_raw_minus_inbound_upsert_ms).toBe(0);
    expect(t.incidents).toHaveLength(1);
    // A telemetria não carrega conclusão de causa.
    expect(JSON.stringify([t.logs, t.incidents])).not.toMatch(/H4|H5|pipeline|deixou de entregar|travad/i);
  });

  it("sem stanza crua nem upsert recebido = NO_RAW_NO_INBOUND_UPSERT", () => {
    const t = setup();
    t.open();
    t.advance(2 * MINUTE); t.observer.tick();
    expect(t.logs.find((entry) => entry.event === "obs.silence_checkpoint")?.classification).toBe(NO_RAW_NO_INBOUND_UPSERT);
  });

  it("mensagem do próprio número não conta como recebida", () => {
    const t = setup();
    t.open();
    t.advance(3 * MINUTE);
    t.observer.upsert("s1", "append", [groupMessage(true)], CIPHERTEXT, INST, 1);
    t.observer.tick();
    expect(t.logs.some((entry) => entry.event === "obs.silence_checkpoint" && entry.level_minutes === 2)).toBe(true);
  });

  it("mensagem recebida encerra o episódio e resolve o incidente", async () => {
    const t = setup();
    t.open();
    t.advance(21 * MINUTE); t.observer.tick();
    await Promise.resolve();
    const incidentId = t.incidents[0].incident_id;
    t.advance(MINUTE);
    t.observer.upsert("s1", "notify", [groupMessage()], CIPHERTEXT, INST, 1);
    await Promise.resolve();
    expect(t.resolved).toEqual([{ id: incidentId, silenceMs: 22 * MINUTE }]);
  });
});

describe("observabilidade: tetos de gravação", () => {
  it("pré-reinício só grava em silêncio e reaproveita o incident_id", async () => {
    const t = setup();
    t.open();
    t.observer.upsert("s1", "notify", [groupMessage()], CIPHERTEXT, INST, 1);
    expect(t.observer.freezeBeforeRestart("s1", "api_restart")).toBeNull();
    t.advance(21 * MINUTE); t.observer.tick();
    await Promise.resolve();
    await t.observer.freezeBeforeRestart("s1", "ensure_listening");
    expect(t.incidents.map((row) => row.kind)).toEqual(["silence_20m", "pre_restart"]);
    expect(t.incidents[1].incident_id).toBe(t.incidents[0].incident_id);
  });

  it("reaquisição em massa: teto por minuto, por número e por hora", async () => {
    const t = setup({ perHour: 30 });
    for (let i = 0; i < 72; i += 1) t.open(`s${i}`);
    t.advance(3 * MINUTE); t.observer.tick();
    for (let i = 0; i < 72; i += 1) await t.observer.freezeBeforeRestart(`s${i}`, "lease_lost");
    expect(t.incidents).toHaveLength(12); // por minuto
    // O mesmo número não grava de novo antes de 10 min.
    t.advance(2 * MINUTE);
    for (let i = 0; i < 12; i += 1) await t.observer.freezeBeforeRestart(`s${i}`, "lease_lost");
    expect(t.incidents).toHaveLength(12);
    // Uma hora de reaquisições em massa não passa do teto por hora.
    for (let minute = 0; minute < 60; minute += 1) {
      t.advance(MINUTE);
      for (let i = 0; i < 72; i += 1) await t.observer.freezeBeforeRestart(`s${i}`, "lease_lost");
    }
    const lastHour = t.incidents.filter((row) => Date.parse(row.detected_at) > Date.UTC(2026, 9, 7, 12, 0, 0) + 6 * MINUTE);
    expect(lastHour.length).toBeLessThanOrEqual(30);
  });
});

describe("observabilidade: atribuição por instância e socket", () => {
  it("duas instâncias vivas do mesmo número ficam separadas, não somadas", () => {
    const t = setup();
    t.open("s1", "aaaaaaaa-1111", 1);
    t.open("s1", "bbbbbbbb-2222", 3);
    t.observer.frame("s1", rawGroup, "aaaaaaaa-1111", 1);
    t.observer.frame("s1", rawGroup, "aaaaaaaa-1111", 1);
    t.observer.frame("s1", rawGroup, "bbbbbbbb-2222", 3);
    t.observer.upsert("s1", "notify", [groupMessage()], CIPHERTEXT, "bbbbbbbb-2222", 3);
    const snapshot = t.observer.snapshot("s1");
    const sockets = snapshot.sockets as Array<{ socket: string; raw_message: number; inbound_msgs: number; live: boolean }>;
    expect(snapshot.live_socket_count).toBe(2);
    expect(sockets.map((s) => [s.socket, s.raw_message, s.inbound_msgs])).toEqual([["aaaaaaaa#1", 2, 0], ["bbbbbbbb#3", 1, 1]]);
    t.advance(MINUTE);
    const row = t.observer.collectClosedMinutes().rows.find((r) => r.session_name === "s1")!;
    expect(row.data.s?.[socketKey("aaaaaaaa-1111", 1)].raw_message).toBe(2);
    expect(row.data.s?.[socketKey("bbbbbbbb-2222", 3)].raw_message).toBe(1);
  });

  it("conta retry recebido, ack e falha de decriptação por tipo", () => {
    const t = setup();
    t.open();
    t.observer.frame("s1", { tag: "receipt", attrs: { type: "retry" } }, INST, 1);
    t.observer.frame("s1", { tag: "ack", attrs: { class: "message" } }, INST, 1);
    t.observer.frame("s1", new Uint8Array([1, 2]), INST, 1);
    t.observer.upsert("s1", "notify", [groupMessage(false, CIPHERTEXT, "Bad MAC"), groupMessage(false, CIPHERTEXT, "Over 2000 messages into the future!")], CIPHERTEXT, INST, 1);
    const history = t.observer.snapshot("s1").history as Array<{ c: Record<string, number> }>;
    const counters = history[history.length - 1].c;
    expect([counters.retry_receipt_in, counters.ack_message, counters.raw_frames, counters.decrypt_fail_bad_mac, counters.decrypt_fail_over2000]).toEqual([1, 1, 2, 1, 1]);
  });
});

describe("observabilidade: canary e gravação em lote", () => {
  it("canary instrumenta só os números escolhidos; o processo continua global", () => {
    const t = setup({ sessions: ["s1"] });
    t.observer.count("s1", "raw_message");
    t.observer.count("s2", "raw_message");
    t.observer.count(PROCESS_SESSION, "supervisor_cycles");
    t.advance(MINUTE);
    expect(t.observer.collectClosedMinutes().rows.map((row) => row.session_name).sort()).toEqual([PROCESS_SESSION, "s1"]);
  });

  it("grava em lote só minutos fechados, uma vez, e guarda se o banco falhar", async () => {
    const t = setup();
    t.observer.count("s1", "raw_message");
    t.observer.count("s2", "raw_message");
    expect(await t.observer.flush()).toBe(0);
    t.advance(MINUTE);
    (t.persistence.writeMinutes as any).mockRejectedValueOnce(new Error("timeout"));
    expect(await t.observer.flush()).toBe(0);
    expect(await t.observer.flush()).toBe(2);
    expect(await t.observer.flush()).toBe(0);
  });

  it("o ring guarda só os últimos minutos configurados", () => {
    const t = setup();
    for (let i = 0; i < 70; i += 1) { t.observer.count("s1", "raw_message"); t.advance(MINUTE); }
    expect((t.observer.snapshot("s1").history as unknown[]).length).toBe(60);
  });

  it("classifica erros de decriptação e lê a lista do canary", () => {
    expect(classifyDecryptError("Bad MAC")).toBe("bad_mac");
    expect(classifyDecryptError("MessageCounterError: Key used already or never filled")).toBe("counter");
    expect(classifyDecryptError(undefined)).toBe("other");
    expect(parseSessionList(" a, b ,,")).toEqual(["a", "b"]);
    expect(parseSessionList("")).toBeNull();
  });
});

describe("observabilidade: liga/desliga real e queda", () => {
  const crashDir = mkdtempSync(join(tmpdir(), "obs-crash-"));
  let bootstrap: typeof import("../observability/bootstrap.js");

  beforeAll(async () => {
    process.env.OBS_CRASH_DIR = crashDir;
    process.env.OBS_PERSIST = "false";
    process.env.OBS_ENABLED = "false";
    bootstrap = await import("../observability/bootstrap.js");
    bootstrap.startObservability();
  });
  afterAll(() => { sharedObserver.configure({ enabled: false, sessions: null }); });

  const fakeSocket = () => {
    const ws = new EventEmitter() as EventEmitter & { isOpen: boolean };
    ws.isOpen = true;
    return { ws };
  };

  it("desligado = zero hooks; liga e desliga sem recriar o socket", () => {
    const sock = fakeSocket();
    const hooks = createInstanceHooks("n1", "11111111-aaaa", "acct", () => ({ status: "connected" }));
    hooks.socketCreated(sock, 1);
    expect(sock.ws.listenerCount("frame")).toBe(0);
    expect(observabilityListenerCount()).toBe(0);
    expect(bootstrap.runtimeHookState()).toMatchObject({ timers: 0, crash_monitor: false });

    sharedObserver.configure({ enabled: true });
    expect(sock.ws.listenerCount("frame")).toBe(1);
    expect(sock.ws.listenerCount("message")).toBe(1);
    expect(bootstrap.runtimeHookState()).toMatchObject({ timers: 4, crash_monitor: true });
    sock.ws.emit("frame", rawGroup);
    expect((sharedObserver.snapshot("n1").sockets as Array<{ raw_message: number }>)[0].raw_message).toBe(1);

    sharedObserver.configure({ enabled: false });
    expect(sock.ws.listenerCount("frame")).toBe(0);
    expect(sock.ws.listenerCount("message")).toBe(0);
    expect(bootstrap.runtimeHookState()).toMatchObject({ timers: 0, crash_monitor: false });
    hooks.release("test");
  });

  it("canary em tempo de execução liga só o número escolhido", () => {
    const a = fakeSocket();
    const b = fakeSocket();
    const hooksA = createInstanceHooks("canary-a", "22222222-aaaa", null, () => ({}));
    const hooksB = createInstanceHooks("canary-b", "33333333-bbbb", null, () => ({}));
    hooksA.socketCreated(a, 1);
    hooksB.socketCreated(b, 1);
    sharedObserver.configure({ enabled: true, sessions: ["canary-a"] });
    expect([a.ws.listenerCount("frame"), b.ws.listenerCount("frame")]).toEqual([1, 0]);
    sharedObserver.configure({ sessions: null });
    expect([a.ws.listenerCount("frame"), b.ws.listenerCount("frame")]).toEqual([1, 1]);
    sharedObserver.configure({ enabled: false });
    expect([a.ws.listenerCount("frame"), b.ws.listenerCount("frame")]).toEqual([0, 0]);
    hooksA.release("test");
    hooksB.release("test");
  });

  it("na queda grava o ring de forma síncrona e mantém só os 3 últimos arquivos", () => {
    sharedObserver.configure({ enabled: true, sessions: null });
    sharedObserver.count("crash-n", "raw_message", 7);
    for (let i = 0; i < 5; i += 1) bootstrap.writeCrashDump("uncaughtException", new Error(`boom ${i}`));
    const files = readdirSync(crashDir).filter((name) => name.endsWith(".json") && name.startsWith("disparei-obs-crash-"));
    expect(files.length).toBeLessThanOrEqual(3);
    const dump = JSON.parse(readFileSync(join(crashDir, files.sort().at(-1)!), "utf8"));
    const session = dump.sessions.find((item: { session_name: string }) => item.session_name === "crash-n");
    expect(session.history.at(-1).c.raw_message).toBe(7);
    expect(dump.error).toContain("boom");
    sharedObserver.configure({ enabled: false });
  });
});
