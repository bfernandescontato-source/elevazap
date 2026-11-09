import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildOfferCopy } from "@disparei/affiliate-links/offer-copy";
import { normalizeSlugInput, slugify, validateSlug } from "@/modules/offer-page/slug";
import { extractOfferLink, extractPrices, extractTitle, storeOfUrl } from "@/modules/offer-page/offer-text";
import { toPublicItem, toPublicItems, toPublicPage } from "@/modules/offer-page/public-mapper";
import { offerPageSettingsSchema } from "@/modules/offer-page/schemas";

const NOW = new Date("2026-11-06T12:00:00Z");
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 86_400_000).toISOString();

const pilotText = buildOfferCopy({
  productName: "Fone Bluetooth JBL Tune 520BT",
  priceFromCents: 39990, priceToCents: 19990, priceCondition: null, statedDiscountPercent: null, coupon: null, extraLines: []
}, "https://s.shopee.com.br/AbC123", () => 0);

describe("endereço da vitrine", () => {
  it("aceita endereços simples e normaliza para minúsculas", () => {
    expect(validateSlug("ana-achados")).toEqual({ ok: true, slug: "ana-achados" });
    expect(validateSlug("  Loja123 ")).toEqual({ ok: true, slug: "loja123" });
  });

  it("recusa formato inválido, tamanho e palavras reservadas", () => {
    for (const bad of ["ab", "-ana", "ana-", "ana--achados", "ana achados", "ána", "ana_achados", "a".repeat(41)]) {
      expect(validateSlug(bad).ok, bad).toBe(false);
    }
    for (const reserved of ["admin", "api", "login", "disparei", "suporte", "piloto-automatico", "configuracoes"]) {
      expect(validateSlug(reserved).ok, reserved).toBe(false);
    }
  });

  it("sugere um endereço a partir do nome e limpa a digitação", () => {
    expect(slugify("Ana Lúcia Achados!")).toBe("ana-lucia-achados");
    expect(normalizeSlugInput("Ana ")).toBe("ana-");
    expect(normalizeSlugInput("--Ação")).toBe("acao");
  });

  it("o schema do painel aplica a mesma regra e exige uma loja", () => {
    const base = { enabled: true, slug: "ana-achados", title: "Ofertas da Ana", bio: "", useProfilePhoto: false, stores: ["SHOPEE"] };
    expect(offerPageSettingsSchema.safeParse(base).success).toBe(true);
    expect(offerPageSettingsSchema.safeParse({ ...base, slug: "admin" }).success).toBe(false);
    expect(offerPageSettingsSchema.safeParse({ ...base, stores: [] }).success).toBe(false);
    expect(offerPageSettingsSchema.safeParse({ ...base, stores: ["ALIEXPRESS"] }).success).toBe(false);
  });

  it("a regra do banco é a mesma da tela", () => {
    const sql = readFileSync(new URL("../../supabase/migrations/20261106120900_offer_page.sql", import.meta.url), "utf8");
    expect(sql).toContain("char_length(slug) between 3 and 40 and slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'");
  });
});

describe("leitura da mensagem enviada", () => {
  it("extrai exatamente o link de loja enviado, ignorando outros links", () => {
    const text = "Entre no grupo https://chat.whatsapp.com/XYZ\n*COMPRE AQUI* 👇\n🛒 https://meli.la/2xYz9Q).\nhttps://amzn.to/zzz";
    expect(extractOfferLink(text)).toBe("https://meli.la/2xYz9Q");
    expect(extractOfferLink("http://s.shopee.com.br/abc")).toBeNull();
    expect(extractOfferLink("https://exemplo.com/oferta")).toBeNull();
    expect(extractOfferLink(null)).toBeNull();
  });

  it("reconhece as lojas pelo endereço", () => {
    expect(storeOfUrl("https://s.shopee.com.br/x")).toBe("SHOPEE");
    expect(storeOfUrl("https://produto.mercadolivre.com.br/MLB-1")).toBe("MERCADO_LIVRE");
    expect(storeOfUrl("https://www.amazon.com.br/dp/B0?tag=x")).toBe("AMAZON");
    expect(storeOfUrl("https://www.magazinevoce.com.br/magazineana/p/abc123/")).toBe("MAGALU");
    expect(storeOfUrl("https://shopee.com.br.golpe.com/x")).toBeNull();
    expect(storeOfUrl("https://user:pass@amazon.com.br/x")).toBeNull();
  });

  it("lê nome e preços do modelo fixo do Piloto e do Catálogo", () => {
    expect(extractTitle(pilotText)).toBe("Fone Bluetooth JBL Tune 520BT");
    expect(extractPrices(pilotText)).toEqual({ priceCents: 19990, oldPriceCents: 39990 });
  });

  it("lê mensagens livres sem confundir gancho, cupom ou telefone com o nome", () => {
    const text = "OLHA ESSE PREÇO 😳\n*Air Fryer Mondial 4L* chama (11) 98765-4321\nDe R$ 499,00 por R$ 299,90\nCupom de R$ 20 OFF\nhttps://amzn.to/abc";
    expect(extractTitle(text)).toBe("Air Fryer Mondial 4L chama");
    expect(extractPrices(text)).toEqual({ priceCents: 29990, oldPriceCents: 49900 });
    expect(extractPrices("Só R$ 59,90 hoje")).toEqual({ priceCents: 5990, oldPriceCents: null });
  });
});

describe("mapeador público", () => {
  const row = {
    product_key: "item:SHOPEE:123", store: "SHOPEE", link: "https://s.shopee.com.br/AbC123", message: pilotText,
    title: null, price: null, original_price: null, image_url: null, sent_at: daysAgo(1),
    // Campos que nunca podem sair para a página, mesmo se o banco mandar:
    account_id: "00000000-0000-0000-0000-000000000001", group_jid: "120363000000000000@g.us", nome_grupo: "Grupo VIP",
    phone: "5511987654321", avatar_path: "community/abc/def/foto.png"
  } as any;

  it("expõe só campos públicos", () => {
    const item = toPublicItem(row)!;
    expect(Object.keys(item).sort()).toEqual(["discountPercent", "id", "imageUrl", "link", "oldPriceCents", "priceCents", "sentAt", "store", "storeLabel", "title"]);
    const serialized = JSON.stringify(item);
    for (const secret of ["00000000-0000", "@g.us", "Grupo VIP", "5511987654321", "community/", "item:SHOPEE", "CORRE", "⚠️"]) {
      expect(serialized).not.toContain(secret);
    }
    expect(item).toMatchObject({ title: "Fone Bluetooth JBL Tune 520BT", store: "SHOPEE", storeLabel: "Shopee", priceCents: 19990, oldPriceCents: 39990, discountPercent: 50 });
  });

  it("prefere os dados do Catálogo e recusa imagem ou link fora da allowlist", () => {
    const catalog = toPublicItem({ ...row, title: "Garrafa Térmica 1L", price: "49.90", original_price: "89.90", image_url: "https://cf.shopee.com.br/file/x.jpg" })!;
    expect(catalog).toMatchObject({ title: "Garrafa Térmica 1L", priceCents: 4990, oldPriceCents: 8990, imageUrl: "https://cf.shopee.com.br/file/x.jpg" });
    expect(toPublicItem({ ...row, image_url: "javascript:alert(1)" })!.imageUrl).toBeNull();
    expect(toPublicItem({ ...row, image_url: "http://inseguro.com/x.jpg" })!.imageUrl).toBeNull();
    expect(toPublicItem({ ...row, link: "https://golpe.com/x", message: "sem link de loja" })).toBeNull();
    expect(toPublicItem({ ...row, link: "javascript:alert(1)" })!.link).toBe("https://s.shopee.com.br/AbC123");
  });

  it("remove repetidos, ordena do mais novo e respeita 30 dias, lojas e limite", () => {
    const rows = [
      { ...row, product_key: "a", link: "https://s.shopee.com.br/old", sent_at: daysAgo(3) },
      { ...row, product_key: "b", link: "https://s.shopee.com.br/new", sent_at: daysAgo(1) },
      { ...row, product_key: "c", link: "https://amzn.to/x", store: "AMAZON", message: "Cafeteira Expresso Oster\nPor R$ 399,00\nhttps://amzn.to/x", sent_at: daysAgo(2) },
      { ...row, product_key: "d", link: "https://meli.la/old", store: "MERCADO_LIVRE", message: "Panela Antiaderente Tramontina\nhttps://meli.la/old", sent_at: daysAgo(40) }
    ];
    const items = toPublicItems(rows, { now: NOW });
    expect(items.map((item) => item.link)).toEqual(["https://s.shopee.com.br/new", "https://amzn.to/x"]);
    expect(toPublicItems(rows, { now: NOW, stores: ["AMAZON"] }).map((item) => item.store)).toEqual(["AMAZON"]);
    const many = Array.from({ length: 80 }, (_, index) => ({ ...row, product_key: `k${index}`, link: `https://s.shopee.com.br/p${index}`, title: `Produto número ${index}`, sent_at: daysAgo(index / 10) }));
    expect(toPublicItems(many, { now: NOW })).toHaveLength(60);
  });

  it("monta a página sem campos internos", () => {
    const page = toPublicPage({ slug: "ana-achados", title: "Ofertas da Ana", bio: "Achadinhos", stores: ["SHOPEE", "XPTO"], items: [row], avatar_path: "community/x", account_id: "y" } as any, null, NOW)!;
    expect(Object.keys(page).sort()).toEqual(["avatarUrl", "bio", "items", "slug", "stores", "title"]);
    expect(page.stores).toEqual(["SHOPEE"]);
    expect(page.items).toHaveLength(1);
    expect(JSON.stringify(page)).not.toContain("community/");
  });
});
