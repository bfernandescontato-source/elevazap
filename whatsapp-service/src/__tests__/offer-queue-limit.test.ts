import { describe, expect, it } from "vitest";
import { queueAdmissionRejection } from "../offers/offer-processor.js";

describe("limite da fila do Piloto Automático", () => {
  it("interrompe cedo uma oferta recusada por fila cheia", () => {
    expect(queueAdmissionRejection({ status: "ignored", error_code: "PILOT_QUEUE_FULL" })).toBe("full");
  });

  it("não confunde ofertas comuns com recusa de capacidade", () => {
    expect(queueAdmissionRejection({ status: "processing" })).toBeNull();
    expect(queueAdmissionRejection({ status: "ignored", error_code: "UNSUPPORTED_MARKETPLACE_LINK" })).toBeNull();
  });
});
