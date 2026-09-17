import { describe, expect, it } from "vitest";
import { generateWAMessageContent } from "@whiskeysockets/baileys";
import { normalizeWhatsappOfferText } from "../offers/whatsapp-copy.js";

describe("copy e card de oferta no WhatsApp", () => {
  it("converte Markdown sem alterar preço, emoji ou link de afiliado", () => {
    const link = "https://s.shopee.com.br/3g3lCsEB6G?lp=aff";
    const original = `## 🛍️ **Kit 2 Gloss Labial**  \n\n*De:* ~R$ 25,00~  \n💸 *Por:* *R$ 17,50*  \n\n🛒 **Compre aqui:** ${link}`;
    expect(normalizeWhatsappOfferText(original)).toBe(`🛍️ *Kit 2 Gloss Labial*\n\n*De:* ~R$ 25,00~\n💸 *Por:* *R$ 17,50*\n\n🛒 *Compre aqui:* ${link}`);
  });

  it("monta preview nativo na mesma mensagem, não mídia separada", async () => {
    const link = "https://s.shopee.com.br/3g3lCsEB6G?lp=aff";
    const message = await generateWAMessageContent({
      text: `🛍️ *Kit Gloss*\n\n${link}`,
      linkPreview: {
        "canonical-url": "https://shopee.com.br/product/434200296/58201363753",
        "matched-text": link,
        title: "Kit 2 Gloss Labial com Sabor PhalleBeauty",
        description: "shopee.com.br",
        jpegThumbnail: Buffer.from([0xff, 0xd8, 0xff, 0xd9])
      }
    }, {} as never);
    expect(message.extendedTextMessage?.matchedText).toBe(link);
    expect(message.extendedTextMessage?.jpegThumbnail?.length).toBeGreaterThan(0);
    expect(message.imageMessage).toBeNull();
  });
});
