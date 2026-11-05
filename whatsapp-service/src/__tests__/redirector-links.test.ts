import { describe, expect, it } from "vitest";
import { expandRedirectorLinks, extractRedirectTarget } from "../offers/redirector-links.js";

const product = "https://s.shopee.com.br/8AXQm7x362";
const page = `<script>window.location.replace(atob("${Buffer.from(product).toString("base64")}"))</script>`;
const fakeFetch = (body: string, url = "https://ofertou.me/abc") =>
  (async () => ({ ok: true, url, text: async () => body })) as unknown as typeof fetch;

describe("encurtadores que escondem o link do marketplace", () => {
  it("lê o link escondido em atob()", () => {
    expect(extractRedirectTarget(page)).toBe(product);
  });

  it("não aceita destino fora dos marketplaces", () => {
    expect(extractRedirectTarget(`atob("${Buffer.from("https://golpe.example/x").toString("base64")}")`)).toBeUndefined();
  });

  it("troca o ofertou.me pelo link real e mantém o cupom", async () => {
    const text = "Compre aqui 👇\nhttps://ofertou.me/TFW5xA8TgtFH6bhj\n\nCupom 👇\nhttps://s.shopee.com.br/4LJYfQz0xU";
    const result = await expandRedirectorLinks(text, fakeFetch(page));
    expect(result).toContain(product);
    expect(result).not.toContain("ofertou.me");
    expect(result).toContain("https://s.shopee.com.br/4LJYfQz0xU");
  });

  it("deixa o texto como está quando a página não abre", async () => {
    const failing = (async () => { throw new Error("timeout"); }) as unknown as typeof fetch;
    const text = "https://ofertou.me/x";
    expect(await expandRedirectorLinks(text, failing)).toBe(text);
  });

  it("não chama a rede quando não há encurtador", async () => {
    const never = (async () => { throw new Error("não devia buscar"); }) as unknown as typeof fetch;
    expect(await expandRedirectorLinks("https://meli.la/abc", never)).toBe("https://meli.la/abc");
  });
});
