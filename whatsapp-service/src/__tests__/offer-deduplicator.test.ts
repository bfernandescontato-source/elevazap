import { describe, expect, it } from "vitest";
import { classifyDuplicate } from "../offers/offer-deduplicator.js";

describe("OfferDeduplicator", () => {
  it("aceita a primeira URL e marca a segunda como duplicada", () => {
    const offer = { links: ["https://s.shopee.com.br/abc"], contentHash: "hash-1" };
    expect(classifyDuplicate([], offer)).toBeNull();
    expect(classifyDuplicate([{ id: "first", original_link: offer.links[0], content_hash: "different" }], offer)).toBe("first");
  });

  it("marca URLs diferentes do mesmo item como duplicadas", () => {
    const history = [{ id: "first", original_link: "https://s.shopee.com.br/a", content_hash: "a", item_id: "456" }];
    expect(classifyDuplicate(history, { links: ["https://s.shopee.com.br/b"], contentHash: "b", itemId: "456" })).toBe("first");
  });
});
