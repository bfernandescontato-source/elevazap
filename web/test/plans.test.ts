import { describe, expect, it } from "vitest";
import { getPlanFromOfferCode } from "../lib/plans";

describe("ofertas Hubla", () => {
  it("associa a oferta Shop Lab ao plano Start", () => {
    expect(getPlanFromOfferCode("DaheQpgnIGPTloukiCPa")).toBe("start");
  });
});
