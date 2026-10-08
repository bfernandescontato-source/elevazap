import { describe, expect, it, vi } from "vitest";
import { guardOfflineBuffer } from "../utils/offline-buffer-guard.js";

function fakeSock(buffering: { value: boolean }) {
  return {
    ws: { isOpen: true },
    ev: { isBuffering: () => buffering.value, flush: vi.fn(() => { buffering.value = false; }) },
    sendNode: vi.fn(async () => undefined)
  };
}

describe("número surdo: buffer de mensagens pendentes travado", () => {
  it("pede o próximo lote e força o flush se o servidor não confirmar", async () => {
    vi.useFakeTimers();
    const buffering = { value: true };
    const sock = fakeSock(buffering);
    const log = vi.fn();
    guardOfflineBuffer(sock, log);
    await vi.advanceTimersByTimeAsync(50_000);
    expect(sock.sendNode).toHaveBeenCalledTimes(5);
    expect(sock.sendNode.mock.calls[0][0]).toMatchObject({ tag: "ib", content: [{ tag: "offline_batch" }] });
    expect(sock.ev.flush).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(sock.ev.flush).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith("whatsapp.offline_buffer_forced_flush", expect.any(Object));
    await vi.advanceTimersByTimeAsync(10_000);
    expect(log).toHaveBeenCalledWith("whatsapp.offline_buffer_released", expect.objectContaining({ forced_flushes: 1 }));
    vi.useRealTimers();
  });

  it("não faz nada quando o buffer libera sozinho", async () => {
    vi.useFakeTimers();
    const buffering = { value: false };
    const sock = fakeSock(buffering);
    guardOfflineBuffer(sock, vi.fn());
    await vi.advanceTimersByTimeAsync(120_000);
    expect(sock.sendNode).not.toHaveBeenCalled();
    expect(sock.ev.flush).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});
