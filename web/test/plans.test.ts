import { describe, expect, it } from "vitest";
import { getPlanFromOfferCode } from "../lib/plans";

describe("ofertas Hubla", () => {
  it("associa a oferta Shop Lab ao plano Start", () => {
    expect(getPlanFromOfferCode("DaheQpgnIGPTloukiCPa")).toBe("start");
  });

  it("libera o plano Start na compra do plano anual", () => {
    expect(getPlanFromOfferCode("ILPh7mvrbMcJPrwggaB8")).toBe("start");
  });
});
