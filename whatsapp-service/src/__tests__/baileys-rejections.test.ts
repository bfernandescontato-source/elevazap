import { describe, expect, it } from "vitest";
import { Boom } from "@hapi/boom";
import { isClosedSocketRejection } from "../utils/baileys-rejections.js";

describe("rejeições de socket fechado do Baileys", () => {
  it("reconhece só o Connection Closed (428)", () => {
    expect(isClosedSocketRejection(new Boom("Connection Closed", { statusCode: 428 }))).toBe(true);
    expect(isClosedSocketRejection(new Boom("Connection Lost", { statusCode: 408 }))).toBe(false);
    expect(isClosedSocketRejection(new Error("Connection Closed"))).toBe(false);
    expect(isClosedSocketRejection(undefined)).toBe(false);
  });
});
