import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

// Usa o arquivo REAL instalado do Baileys (já corrigido pelo pretest) e extrai o trecho
// do pedido de reenvio, com dependências falsas para contar o que ele faz.
const require = createRequire(import.meta.url);
const source = readFileSync(require.resolve("@whiskeysockets/baileys/lib/Socket/messages-recv.js"), "utf8");
const begin = source.indexOf("const willSendMessageAgain = (id, participant) => {");
const end = source.indexOf("const handleReceipt = async", begin);

function buildRetry(getMessage: (key: any) => Promise<unknown>) {
  const counts = new Map<string, number>();
  const msgRetryCache = { get: (k: string) => counts.get(k), set: (k: string, v: number) => void counts.set(k, v) };
  const calls = { forcedSessions: 0, relays: 0 };
  const factory = new Function("getMessage", "jidDecode", "assertSessions", "isJidGroup", "authState", "logger",
    "relayMessage", "msgRetryCache", "maxMsgRetryCount",
    `${source.slice(begin, end)}\nreturn { willSendMessageAgain, sendMessagesAgain };`);
  const fns = factory(getMessage, () => ({ device: 1 }), async () => { calls.forcedSessions++; }, () => false,
    { keys: { set: async () => undefined } }, { debug: () => undefined }, async () => { calls.relays++; }, msgRetryCache, 5);
  // Mesmo fluxo do handleReceipt: só tenta se ainda não passou do limite.
  async function receipt(id: string, participant = "peer:1@s.whatsapp.net") {
    if (fns.willSendMessageAgain(id, participant)) await fns.sendMessagesAgain({ remoteJid: "grupo@g.us", participant, fromMe: true }, [id], { attrs: { count: "1" } });
  }
  return { receipt, calls, counts };
}

describe("pedido de reenvio (Baileys 6.7.23 corrigido)", () => {
  it("o trecho corrigido está instalado", () => {
    expect(begin).toBeGreaterThan(0);
    expect(source).toContain("// disparei-patch: retry-sem-mensagem");
  });

  it("mensagem inexistente pedida 100 vezes: nenhuma sessão nova e o limite de 5 vale", async () => {
    const r = buildRetry(async () => undefined);
    for (let i = 0; i < 100; i++) await r.receipt("sumiu");
    expect(r.calls.forcedSessions).toBe(0);
    expect(r.calls.relays).toBe(0);
    expect(r.counts.get("sumiu:peer:1@s.whatsapp.net")).toBe(5);
  });

  it("reenvio legítimo continua: força a sessão e reenvia, até o limite", async () => {
    const r = buildRetry(async () => ({ conversation: "oferta" }));
    for (let i = 0; i < 10; i++) await r.receipt("existe");
    expect(r.calls.forcedSessions).toBe(5);
    expect(r.calls.relays).toBe(5);
  });

  it("limite é por mensagem e por aparelho", async () => {
    const r = buildRetry(async () => undefined);
    for (let i = 0; i < 10; i++) { await r.receipt("a", "p1:1@s.whatsapp.net"); await r.receipt("a", "p2:1@s.whatsapp.net"); }
    expect(r.counts.get("a:p1:1@s.whatsapp.net")).toBe(5);
    expect(r.counts.get("a:p2:1@s.whatsapp.net")).toBe(5);
    expect(r.calls.forcedSessions).toBe(0);
  });
});
