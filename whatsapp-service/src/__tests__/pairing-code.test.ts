import { describe, expect, it } from "vitest";
import { formatPairingCode, pairingPhoneDigits } from "../utils/pairing-code.js";

describe("conectar por código (sem QR)", () => {
  it("aceita o número com DDI, com ou sem máscara", () => {
    expect(pairingPhoneDigits("+55 (11) 96916-9630")).toBe("5511969169630");
    expect(pairingPhoneDigits("551199998888")).toBe("551199998888");
  });

  it("recusa número curto demais (sem DDI) ou comprido demais", () => {
    expect(pairingPhoneDigits("11999998888")).toBe("");
    expect(pairingPhoneDigits("1234567890123456")).toBe("");
  });

  it("mostra o código como o WhatsApp pede: ABCD-EFGH", () => {
    expect(formatPairingCode("abcd1234")).toBe("ABCD-1234");
    expect(formatPairingCode("ABCD-1234")).toBe("ABCD-1234");
  });
});
