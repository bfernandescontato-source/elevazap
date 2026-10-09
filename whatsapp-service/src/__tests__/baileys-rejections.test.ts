import { describe, expect, it } from "vitest";
import { Boom } from "@hapi/boom";
import { isClosedSocketRejection, isSocketWriteErrorRejection, isTimedOutQueryRejection, isWebSocketCloseCodeRejection } from "../utils/baileys-rejections.js";

describe("rejeições de socket fechado do Baileys", () => {
  it("reconhece só o Connection Closed (428)", () => {
    expect(isClosedSocketRejection(new Boom("Connection Closed", { statusCode: 428 }))).toBe(true);
    expect(isClosedSocketRejection(new Boom("Connection Lost", { statusCode: 408 }))).toBe(false);
    expect(isClosedSocketRejection(new Error("Connection Closed"))).toBe(false);
    expect(isClosedSocketRejection(undefined)).toBe(false);
  });

  it("reconhece erro de escrita em socket derrubado (EPIPE/ECONNRESET)", () => {
    const erro = (code: string, syscall: string) => Object.assign(new Error(`${syscall} ${code}`), { code, syscall });
    expect(isSocketWriteErrorRejection(erro("EPIPE", "write"))).toBe(true);
    expect(isSocketWriteErrorRejection(erro("ECONNRESET", "write"))).toBe(true);
    expect(isSocketWriteErrorRejection(erro("ECONNREFUSED", "connect"))).toBe(false);
    expect(isSocketWriteErrorRejection(erro("EPIPE", "read"))).toBe(false);
    expect(isSocketWriteErrorRejection(new Error("write EPIPE"))).toBe(false);
    expect(isSocketWriteErrorRejection(undefined)).toBe(false);
  });

  it("reconhece só o Timed Out (408) de consulta do Baileys", () => {
    expect(isTimedOutQueryRejection(new Boom("Timed Out", { statusCode: 408 }))).toBe(true);
    expect(isTimedOutQueryRejection(new Boom("Connection Lost", { statusCode: 408 }))).toBe(false);
    expect(isTimedOutQueryRejection(new Boom("Timed Out", { statusCode: 500 }))).toBe(false);
    expect(isTimedOutQueryRejection(new Error("Timed Out"))).toBe(false);
    expect(isTimedOutQueryRejection(undefined)).toBe(false);
  });

  it("reconhece o código de fechamento do WebSocket (1006) vindo de consulta", () => {
    expect(isWebSocketCloseCodeRejection(1006)).toBe(true);
    expect(isWebSocketCloseCodeRejection(1000)).toBe(true);
    expect(isWebSocketCloseCodeRejection(999)).toBe(false);
    expect(isWebSocketCloseCodeRejection(5000)).toBe(false);
    expect(isWebSocketCloseCodeRejection(1006.5)).toBe(false);
    expect(isWebSocketCloseCodeRejection("1006")).toBe(false);
    expect(isWebSocketCloseCodeRejection(new Error("1006"))).toBe(false);
    expect(isWebSocketCloseCodeRejection(undefined)).toBe(false);
  });
});
