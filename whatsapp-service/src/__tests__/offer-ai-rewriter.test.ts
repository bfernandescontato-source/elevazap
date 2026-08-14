import { describe, expect, it } from "vitest";
import { OfferAiRewriter, validateRewrite } from "../offers/offer-ai-rewriter.js";

describe("OfferAiRewriter", () => {
  it("aceita copy que preserva preço e link autorizado", () => {
    const link = "https://s.shopee.com.br/novo";
    expect(validateRewrite("Produto por R$ 49,99\nhttps://antigo.example", `🔥 *Produto em oferta*\n\nPor R$ 49,99\n\nGaranta o seu: ${link}`, link)).toContain(link);
  });

  it("rejeita link extra e alteração de preço", () => {
    const link = "https://s.shopee.com.br/novo";
    expect(() => validateRewrite("Produto por R$ 49,99", `Produto por R$ 39,99\n${link}`, link)).toThrow(/preço/);
    expect(() => validateRewrite("Produto por R$ 49,99", `Produto por R$ 49,99\n${link}\nhttps://spam.example`, link)).toThrow(/link não permitido/);
  });

  it("usa saída estruturada da Responses API", async () => {
    const link = "https://s.shopee.com.br/novo";
    const client = {
      responses: {
        create: async () => ({ status: "completed", output_text: JSON.stringify({ rewritten_text: `✨ *Produto em oferta*\n\nPor R$ 49,99\n\nCompre aqui: ${link}` }) })
      }
    } as never;
    const result = await new OfferAiRewriter(undefined, "gpt-test", client).rewrite({
      text: "Produto por R$ 49,99",
      purchaseLink: link,
      links: []
    });
    expect(result.model).toBe("gpt-test");
    expect(result.text).toContain("R$ 49,99");
  });
});
