import { describe, expect, it } from "vitest";
import { parseOffer } from "../offers/offer-parser.js";
import { unwrapMessage } from "../offers/whatsapp-monitor.js";

describe("OfferParser", () => {
  it("extrai texto, grupo e link Shopee", () => {
    const result = parseOffer({
      sourceType: "whatsapp",
      sourceMessageId: "message-1",
      sourceGroupId: "120363000000@g.us",
      text: "🔥 OFERTA\nAir Fryer por R$299\nhttps://s.shopee.com.br/abc",
      timestamp: new Date("2026-08-14T13:00:00Z")
    });
    expect(result.text).toContain("Air Fryer por R$299");
    expect(result.links).toEqual(["https://s.shopee.com.br/abc"]);
    expect(result.shopeeLinks).toEqual(["https://s.shopee.com.br/abc"]);
    expect(result.sourceGroupId).toBe("120363000000@g.us");
  });
});

describe("unwrapMessage", () => {
  it("abre camadas aninhadas até encontrar a imagem", () => {
    const imageMessage = { mimetype: "image/jpeg", caption: "Oferta https://s.shopee.com.br/abc" };
    const wrapped = { ephemeralMessage: { message: { viewOnceMessageV2: { message: { imageMessage } } } } };
    expect(unwrapMessage(wrapped)).toEqual({ imageMessage });
  });

  it("abre imagem enviada como documento com legenda", () => {
    const imageMessage = { mimetype: "image/png", caption: "Oferta" };
    expect(unwrapMessage({ documentWithCaptionMessage: { message: { imageMessage } } })).toEqual({ imageMessage });
  });
});
