import { afterEach, describe, expect, it, vi } from "vitest";
import { GroupPreparation, sendWithDeadline } from "../queue/group-preparation.js";

function socket() {
  return {
    groupMetadata: vi.fn(async () => ({ participants: [{ id: "100@lid" }, { id: "200@lid" }], addressingMode: "lid" })),
    getUSyncDevices: vi.fn(async () => [{ user: "100", device: 2 }, { user: "200", device: 0 }]),
    assertSessions: vi.fn(async () => true),
    authState: { keys: { get: vi.fn(async () => ({})), transaction: async (work: () => Promise<unknown>) => work() } },
    sendMessage: vi.fn(),
    end: vi.fn()
  };
}
afterEach(() => vi.useRealTimers());

describe("preparação de grupos antes do horário", () => {
  it("prepara dispositivos e chaves sem disparar e compartilha o trabalho concorrente", async () => {
    const preparation = new GroupPreparation();
    const sock = socket();
    const [first, second] = await Promise.all([preparation.prepare(sock, "g@g.us"), preparation.prepare(sock, "g@g.us")]);
    expect(first).toBe(second);
    expect(sock.groupMetadata).toHaveBeenCalledTimes(1);
    expect(sock.assertSessions).toHaveBeenCalledWith(["100:2@lid", "200@lid"], false);
    expect(sock.sendMessage).not.toHaveBeenCalled();
    expect(await preparation.cached(sock, "g@g.us")).toBe(first);
  });
  it("não compartilha estado entre números ou reconexões", async () => {
    const preparation = new GroupPreparation();
    const a = socket(), b = socket();
    await preparation.prepare(a, "g@g.us");
    expect(preparation.cached(b, "g@g.us")).toBeUndefined();
    await preparation.prepare(b, "g@g.us");
    expect(b.groupMetadata).toHaveBeenCalledTimes(1);
  });
  it("atualiza participantes após invalidação e após expiração", async () => {
    vi.useFakeTimers();
    const preparation = new GroupPreparation(), sock = socket();
    await preparation.prepare(sock, "g@g.us");
    preparation.invalidate(sock, "g@g.us");
    await preparation.prepare(sock, "g@g.us");
    await vi.advanceTimersByTimeAsync(90_001);
    expect(preparation.cached(sock, "g@g.us")).toBeUndefined();
    await preparation.prepare(sock, "g@g.us");
    expect(sock.groupMetadata).toHaveBeenCalledTimes(3);
  });
  it("permite nova preparação após falha, sem cachear uma promessa rejeitada", async () => {
    const preparation = new GroupPreparation(), sock = socket();
    sock.assertSessions.mockRejectedValueOnce(new Error("rede indisponível"));
    await expect(preparation.prepare(sock, "g@g.us")).rejects.toThrow("rede indisponível");
    expect(preparation.cached(sock, "g@g.us")).toBeUndefined();
    await preparation.prepare(sock, "g@g.us");
    expect(sock.assertSessions).toHaveBeenCalledTimes(2);
  });
});
describe("prazo do envio", () => {
  it("não inicia um envio se a preparação terminou depois do prazo total", async () => {
    const sock = socket(), send = vi.fn(async () => "WA-1"), controller = new AbortController();
    controller.abort();
    await expect(sendWithDeadline(sock, 1000, send, controller.signal)).rejects.toThrow();
    expect(send).not.toHaveBeenCalled();
    expect(sock.end).not.toHaveBeenCalled();
  });
  it("fecha a conexão quando o prazo total termina durante um envio", async () => {
    const sock = socket(), controller = new AbortController();
    let complete!: () => void;
    const waiting = new Promise<void>(resolve => { complete = resolve; });
    const work = sendWithDeadline(sock, 1000, () => waiting, controller.signal);
    controller.abort();
    expect(sock.end).toHaveBeenCalledTimes(1);
    complete();
    await work;
  });
  it("mantém a conexão quando a operação é concluída", async () => {
    const sock = socket();
    expect(await sendWithDeadline(sock, 1000, async () => "WA-1")).toBe("WA-1");
    expect(sock.end).not.toHaveBeenCalled();
  });
  it("fecha somente o socket do envio travado e impede transmissão posterior", async () => {
    vi.useFakeTimers();
    let closed = false;
    const relay = vi.fn();
    const sock = { end: vi.fn(() => { closed = true; }) };
    const other = socket();
    let continueSend!: () => void;
    const waiting = new Promise<void>((resolve) => { continueSend = resolve; });
    const sending = sendWithDeadline(sock, 30_000, async () => { await waiting; if (!closed) relay(); });
    const rejected = expect(sending).rejects.toMatchObject({ operation: "whatsapp.sendMessage" });
    await vi.advanceTimersByTimeAsync(30_000);
    await rejected;
    continueSend();
    await vi.advanceTimersByTimeAsync(1);
    expect(sock.end).toHaveBeenCalledTimes(1);
    expect(other.end).not.toHaveBeenCalled();
    expect(relay).not.toHaveBeenCalled();
  });
});
