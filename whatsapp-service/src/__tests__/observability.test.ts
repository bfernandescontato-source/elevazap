import { describe, expect, it, vi } from "vitest";
import { classifyDecryptError, SessionObserver, type IncidentRow, type MinuteRow, type ObsPersistence } from "../observability/observer.js";

const CIPHERTEXT = 2;
const MINUTE = 60_000;

function setup() {
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
  const observer = new SessionObserver({ now: () => now, ringMinutes: 60, persistence, log: (entry) => logs.push(entry) });
  return {
    observer, minutes, incidents, resolved, logs, persistence,
    advance: (ms: number) => { now += ms; },
    open: (session = "s1") => { observer.socketCreated(session, "inst-a", 1, "acct"); observer.socketOpened(session, "inst-a", 1); }
  };
}

const groupMessage = (fromMe = false, stub?: number, error?: string) => ({
  key: { remoteJid: "123@g.us", fromMe },
  ...(stub ? { messageStubType: stub, messageStubParameters: [error] } : {})
});

describe("observabilidade do número surdo", () => {
  it("separa stanza crua de upsert e marca o silêncio em 2, 5, 10 e 20 minutos", async () => {
    const t = setup();
    t.open();
    t.observer.upsert("s1", "notify", [groupMessage()], CIPHERTEXT);
    t.observer.frame("s1", { tag: "message", attrs: { from: "123@g.us" } });
    t.advance(2 * MINUTE); t.observer.tick();
    t.advance(3 * MINUTE); t.observer.tick();
    t.advance(5 * MINUTE); t.observer.tick();
    t.advance(10 * MINUTE); t.observer.tick();
    await Promise.resolve();

    const checkpoints = t.logs.filter((entry) => entry.event === "obs.silence_checkpoint");
    expect(checkpoints.map((entry) => entry.level_minutes)).toEqual([2, 5, 10, 20]);
    expect(checkpoints.every((entry) => entry.classification === "RAW_WITHOUT_UPSERT")).toBe(true);
    expect(t.incidents).toHaveLength(1);
    expect(t.incidents[0].kind).toBe("silence_20m");
    expect(t.incidents[0].snapshot.raw_since_inbound).toBe(1);
  });

  it("classifica como ALL_SILENT quando nem stanza crua chega", () => {
    const t = setup();
    t.open();
    t.advance(2 * MINUTE); t.observer.tick();
    expect(t.logs.find((entry) => entry.event === "obs.silence_checkpoint")?.classification).toBe("ALL_SILENT");
  });

  it("mensagem enviada pelo próprio número não conta como recebida", () => {
    const t = setup();
    t.open();
    t.advance(3 * MINUTE);
    t.observer.upsert("s1", "append", [groupMessage(true)], CIPHERTEXT);
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
    t.observer.upsert("s1", "notify", [groupMessage()], CIPHERTEXT);
    await Promise.resolve();
    expect(t.resolved).toEqual([{ id: incidentId, silenceMs: 22 * MINUTE }]);
    expect(t.observer.listSessions()[0].level_minutes).toBe(0);
  });

  it("antes de reiniciar só grava quando o número já estava em silêncio, e reaproveita o incident_id", async () => {
    const t = setup();
    t.open();
    t.observer.upsert("s1", "notify", [groupMessage()], CIPHERTEXT);
    expect(t.observer.freezeBeforeRestart("s1", "api_restart")).toBeNull();
    expect(t.incidents).toHaveLength(0);

    t.advance(21 * MINUTE); t.observer.tick();
    await Promise.resolve();
    await t.observer.freezeBeforeRestart("s1", "ensure_listening");
    expect(t.incidents).toHaveLength(2);
    expect(t.incidents[1].kind).toBe("pre_restart");
    expect(t.incidents[1].incident_id).toBe(t.incidents[0].incident_id);
    expect(t.incidents[1].id).not.toBe(t.incidents[0].id);
  });

  it("limita os retratos de pré-reinício numa reaquisição em massa", async () => {
    const t = setup();
    for (let i = 0; i < 15; i += 1) t.open(`s${i}`);
    t.advance(3 * MINUTE); t.observer.tick();
    for (let i = 0; i < 15; i += 1) await t.observer.freezeBeforeRestart(`s${i}`, "lease_lost");
    expect(t.incidents).toHaveLength(12);
    expect(t.observer.listIncidents()).toHaveLength(15);
  });

  it("conta retry recebido, ack e falha de decriptação por tipo", () => {
    const t = setup();
    t.open();
    t.observer.frame("s1", { tag: "receipt", attrs: { type: "retry" } });
    t.observer.frame("s1", { tag: "ack", attrs: { class: "message" } });
    t.observer.frame("s1", new Uint8Array([1, 2]));
    t.observer.upsert("s1", "notify", [groupMessage(false, CIPHERTEXT, "Bad MAC"), groupMessage(false, CIPHERTEXT, "Over 2000 messages into the future!")], CIPHERTEXT);
    const history = t.observer.snapshot("s1").history as Array<{ c: Record<string, number> }>;
    const counters = history[history.length - 1].c;
    expect(counters.retry_receipt_in).toBe(1);
    expect(counters.ack_message).toBe(1);
    expect(counters.raw_frames).toBe(2);
    expect(counters.decrypt_fail).toBe(2);
    expect(counters.decrypt_fail_bad_mac).toBe(1);
    expect(counters.decrypt_fail_over2000).toBe(1);
  });

  it("mostra duas instâncias vivas do mesmo número (sessão órfã) no retrato", () => {
    const t = setup();
    t.observer.registerInstance("s1", "inst-a", () => ({ status: "connected" }));
    t.observer.registerInstance("s1", "inst-b", () => ({ status: "reconnecting" }));
    t.observer.setManagedInstance("s1", "inst-b");
    t.observer.socketCreated("s1", "inst-a", 3);
    t.observer.socketCreated("s1", "inst-b", 1);
    const snapshot = t.observer.snapshot("s1");
    expect(snapshot.live_socket_count).toBe(2);
    expect((snapshot.instances as Array<{ instanceId: string; managed: boolean }>).map((item) => [item.instanceId, item.managed]))
      .toEqual([["inst-a", false], ["inst-b", true]]);
  });

  it("grava em lote só minutos fechados, uma vez, e guarda para o próximo lote se o banco falhar", async () => {
    const t = setup();
    t.observer.count("s1", "raw_message");
    t.observer.count("s2", "raw_message");
    expect(await t.observer.flush()).toBe(0); // minuto ainda aberto
    t.advance(MINUTE);
    (t.persistence.writeMinutes as any).mockRejectedValueOnce(new Error("timeout"));
    expect(await t.observer.flush()).toBe(0);
    expect(await t.observer.flush()).toBe(2);
    expect(t.minutes).toHaveLength(1);
    expect(t.minutes[0]).toHaveLength(2);
    expect(await t.observer.flush()).toBe(0);
  });

  it("o ring guarda só os últimos minutos configurados", () => {
    const t = setup();
    for (let i = 0; i < 70; i += 1) { t.observer.count("s1", "raw_message"); t.advance(MINUTE); }
    expect((t.observer.snapshot("s1").history as unknown[]).length).toBe(60);
  });

  it("classifica os erros de decriptação", () => {
    expect(classifyDecryptError("Bad MAC")).toBe("bad_mac");
    expect(classifyDecryptError("Over 2000 messages into the future!")).toBe("over2000");
    expect(classifyDecryptError("MessageCounterError: Key used already or never filled")).toBe("counter");
    expect(classifyDecryptError("No SenderKeyRecord found for decryption")).toBe("no_senderkey");
    expect(classifyDecryptError("No session found to decrypt message")).toBe("no_session");
    expect(classifyDecryptError(undefined)).toBe("other");
  });
});
