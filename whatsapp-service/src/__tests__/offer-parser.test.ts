import { describe, expect, it } from "vitest";
import { parseOffer } from "../offers/offer-parser.js";
import { mediaFrom, unwrapMessage } from "../offers/whatsapp-monitor.js";

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

  it("classifica Shopee e Mercado Livre na mesma mensagem", () => {
    const result = parseOffer({
      sourceType: "whatsapp", sourceMessageId: "message-2", sourceGroupId: "120363000000@g.us",
      text: "Shopee https://s.shopee.com.br/abc\nML https://meli.la/xyz", timestamp: new Date()
    });
    expect(result.mercadoLivreLinks).toEqual(["https://meli.la/xyz"]);
    expect(result.affiliateLinks).toEqual([
      { provider: "shopee", url: "https://s.shopee.com.br/abc" },
      { provider: "mercado_livre", url: "https://meli.la/xyz" }
    ]);
  });

  it("identifica link da Amazon sem tratá-lo como afiliado suportado", () => {
    const result = parseOffer({
      sourceType: "whatsapp", sourceMessageId: "message-3", sourceGroupId: "120363000000@g.us",
      text: "Fone bom https://www.amazon.com.br/dp/B0ABCDEFG", timestamp: new Date()
    });
    expect(result.amazonLinks).toEqual(["https://www.amazon.com.br/dp/B0ABCDEFG"]);
    expect(result.affiliateLinks).toEqual([]);
  });

  it("identifica link curto amzn.to", () => {
    const result = parseOffer({
      sourceType: "whatsapp", sourceMessageId: "message-4", sourceGroupId: "120363000000@g.us",
      text: "https://amzn.to/abc123", timestamp: new Date()
    });
    expect(result.amazonLinks).toEqual(["https://amzn.to/abc123"]);
  });

  it("identifica link de compartilhamento no gTLD .amazon (ex: link.amazon)", () => {
    const result = parseOffer({
      sourceType: "whatsapp", sourceMessageId: "message-5", sourceGroupId: "120363000000@g.us",
      text: "https://link.amazon/B00jBYJv8", timestamp: new Date()
    });
    expect(result.amazonLinks).toEqual(["https://link.amazon/B00jBYJv8"]);
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

  it("captura a imagem embutida na prévia de um link", async () => {
    const jpegThumbnail = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
    await expect(mediaFrom({ extendedTextMessage: { jpegThumbnail } })).resolves.toEqual({
      buffer: jpegThumbnail,
      mimeType: "image/jpeg",
      extension: "jpg"
    });
  });
});
