import { describe, expect, it } from "vitest";
import { createSentMessageStore } from "../whatsapp/sent-message-store.js";

const sent = (id: string, remoteJid = "grupo@g.us", fromMe = true) => ({ key: { id, remoteJid, fromMe }, message: { conversation: id } });

describe("loja de mensagens enviadas (getMessage do reenvio)", () => {
  it("guarda só mensagens próprias com conteúdo", () => {
    const store = createSentMessageStore();
    store.remember([sent("a"), sent("b", "grupo@g.us", false), { key: { id: "c", remoteJid: "g", fromMe: true } }]);
    expect(store.get({ id: "a", remoteJid: "grupo@g.us" })).toEqual({ conversation: "a" });
    expect(store.get({ id: "b" })).toBeUndefined();
    expect(store.get({ id: "c" })).toBeUndefined();
  });

  it("não entrega a mensagem para outra conversa", () => {
    const store = createSentMessageStore();
    store.remember([sent("a", "grupo-1@g.us")]);
    expect(store.get({ id: "a", remoteJid: "grupo-2@g.us" })).toBeUndefined();
  });

  it("lojas de números diferentes não se misturam", () => {
    const n1 = createSentMessageStore(), n2 = createSentMessageStore();
    n1.remember([sent("a")]);
    expect(n2.get({ id: "a", remoteJid: "grupo@g.us" })).toBeUndefined();
  });

  it("respeita limite de quantidade e de idade", () => {
    let now = 0;
    const store = createSentMessageStore({ max: 3, ttlMs: 1000, now: () => now });
    store.remember([sent("1"), sent("2"), sent("3"), sent("4")]);
    expect(store.size()).toBe(3);
    expect(store.get({ id: "1" })).toBeUndefined();
    now = 2000;
    expect(store.get({ id: "4" })).toBeUndefined();
    expect(store.size()).toBe(0);
  });
});
