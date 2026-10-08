import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { guardNoiseDecrypt, isNoiseDecryptError } from "../utils/noise-guard.js";

function noiseError() {
  const error = new Error("Unsupported state or unable to authenticate data");
  error.stack = "Error: Unsupported state or unable to authenticate data\n    at aesDecryptGCM (crypto.js:61:58)\n    at decrypt (noise-handler.js:28:24)";
  return error;
}

describe("falha de decriptação do transporte (Noise)", () => {
  it("fecha só o socket afetado e não derruba o processo", () => {
    const ws = new EventEmitter();
    const sock = { ws, end: vi.fn() };
    const caught = vi.fn();
    guardNoiseDecrypt(sock, caught);
    ws.on("message", () => { throw noiseError(); });
    expect(() => ws.emit("message", Buffer.from("x"))).not.toThrow();
    expect(caught).toHaveBeenCalledTimes(1);
    expect(sock.end).toHaveBeenCalledTimes(1);
  });

  it("qualquer outro erro continua sendo lançado", () => {
    const ws = new EventEmitter();
    const sock = { ws, end: vi.fn() };
    guardNoiseDecrypt(sock, vi.fn());
    ws.on("message", () => { throw new Error("outro erro"); });
    expect(() => ws.emit("message", Buffer.from("x"))).toThrow("outro erro");
    expect(sock.end).not.toHaveBeenCalled();
  });

  it("outros eventos passam intactos", () => {
    const ws = new EventEmitter();
    guardNoiseDecrypt({ ws, end: vi.fn() }, vi.fn());
    const listener = vi.fn();
    ws.on("frame", listener);
    ws.emit("frame", 1);
    expect(listener).toHaveBeenCalledWith(1);
  });

  it("reconhece só o erro do Noise", () => {
    expect(isNoiseDecryptError(noiseError())).toBe(true);
    expect(isNoiseDecryptError(new Error("Unsupported state or unable to authenticate data"))).toBe(false);
    expect(isNoiseDecryptError(new Error("Bad MAC"))).toBe(false);
  });
});
