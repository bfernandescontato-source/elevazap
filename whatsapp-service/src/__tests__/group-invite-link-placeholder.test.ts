import { describe, expect, it, vi } from "vitest";
import { GroupInviteLinkCache, applyGroupLinkPlaceholder, hasGroupLinkPlaceholder, inviteUrlFromCode } from "../groups/invite-link-placeholder.js";
import { RecurringMessageMaterializer } from "../queue/recurring-materializer.js";

const CODE = "AbCdEfGhIjKlMnOpQrStUv";
const LINK = `https://chat.whatsapp.com/${CODE}`;

describe("{link_do_grupo}", () => {
  it("troca todas as ocorrências pelo link do grupo", () => {
    expect(applyGroupLinkPlaceholder("Entre: {link_do_grupo}\nOu: {link_do_grupo}", LINK)).toBe(`Entre: ${LINK}\nOu: ${LINK}`);
  });

  it("sem link, tira a linha inteira e não deixa buraco", () => {
    expect(applyGroupLinkPlaceholder("Chame amigos\n\nLink:\n{link_do_grupo}\n\nObrigado", null)).toBe("Chame amigos\n\nLink:\n\nObrigado");
    expect(applyGroupLinkPlaceholder("Entre aqui {link_do_grupo}", null)).toBe("");
  });

  it("texto sem variável fica igual", () => {
    expect(applyGroupLinkPlaceholder("Bom dia", null)).toBe("Bom dia");
    expect(hasGroupLinkPlaceholder("Bom dia")).toBe(false);
    expect(hasGroupLinkPlaceholder(undefined)).toBe(false);
  });

  it("só aceita código de convite válido", () => {
    expect(inviteUrlFromCode(CODE)).toBe(LINK);
    expect(inviteUrlFromCode("")).toBeNull();
    expect(inviteUrlFromCode("a/b")).toBeNull();
    expect(inviteUrlFromCode(undefined)).toBeNull();
  });

  it("guarda o link por número e grupo e pede uma vez só", async () => {
    let now = 0;
    const cache = new GroupInviteLinkCache(1000, 100, 10, () => now);
    const fetch = vi.fn(async () => CODE);
    const [a, b] = await Promise.all([cache.resolve("s1", "g1", fetch), cache.resolve("s1", "g1", fetch)]);
    expect(a).toBe(LINK);
    expect(b).toBe(LINK);
    expect(fetch).toHaveBeenCalledTimes(1);
    await cache.resolve("s1", "g2", fetch);
    expect(fetch).toHaveBeenCalledTimes(2);
    now = 1001;
    await cache.resolve("s1", "g1", fetch);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("erro vira sem link e tenta de novo depois de pouco tempo", async () => {
    let now = 0;
    const cache = new GroupInviteLinkCache(1000, 100, 10, () => now);
    const fetch = vi.fn(async () => { throw new Error("not-authorized"); });
    expect(await cache.resolve("s1", "g1", fetch)).toBeNull();
    expect(await cache.resolve("s1", "g1", fetch)).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1);
    now = 101;
    await cache.resolve("s1", "g1", fetch);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});

describe("materialização periódica", () => {
  it("repete enquanto vem o lote cheio e para no resto", async () => {
    const results = [3, 3, 1];
    const rpc = vi.fn(async () => ({ data: results.shift() ?? 0, error: null }));
    expect(await new RecurringMessageMaterializer({ rpc }).tick()).toBe(7);
    expect(rpc).toHaveBeenCalledTimes(3);
    expect(rpc).toHaveBeenCalledWith("materialize_due_recurring_group_messages", { p_limit: 3 });
  });

  it("sem a função no banco, para de tentar", async () => {
    const rpc = vi.fn(async () => ({ data: null, error: { code: "PGRST202", message: "Could not find the function" } }));
    const job = new RecurringMessageMaterializer({ rpc });
    expect(await job.tick()).toBe(0);
    expect(await job.tick()).toBe(0);
    expect(rpc).toHaveBeenCalledTimes(1);
  });
});
