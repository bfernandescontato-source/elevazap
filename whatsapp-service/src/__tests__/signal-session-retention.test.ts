import { createRequire } from "node:module";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { trimSessionRecord } from "../auth/signal-session-retention.js";

// libsignal real (a mesma que o Baileys usa), com chaves sintéticas.
const lib = createRequire(createRequire(import.meta.url).resolve("@whiskeysockets/baileys/package.json"))("libsignal");

const quiet = { info: console.info, warn: console.warn, error: console.error };
beforeAll(() => { console.info = console.warn = console.error = () => undefined; });
afterAll(() => Object.assign(console, quiet));

function makeStore(registrationId: number) {
  const identity = lib.curve.generateKeyPair();
  const signed = lib.curve.generateKeyPair();
  const preKeys = new Map<number, any>();
  const records = new Map<string, any>();
  return {
    identity, signed, preKeys, records,
    loadSession: async (id: string) => records.get(id),
    storeSession: async (id: string, record: any) => void records.set(id, record),
    isTrustedIdentity: async () => true,
    getOurIdentity: async () => identity,
    getOurRegistrationId: async () => registrationId,
    loadSignedPreKey: async () => signed,
    loadPreKey: async (id: number) => preKeys.get(id),
    removePreKey: async (id: number) => void preKeys.delete(id)
  };
}

function bundle(store: ReturnType<typeof makeStore>, registrationId: number) {
  return {
    registrationId,
    identityKey: store.identity.pubKey,
    signedPreKey: { keyId: 1, publicKey: store.signed.pubKey, signature: lib.curve.calculateSignature(store.identity.privKey, store.signed.pubKey) }
  };
}

async function bloated(times: number) {
  const a = makeStore(101), b = makeStore(102);
  const toB = new lib.ProtocolAddress("peer-b", 1);
  // Mesmo efeito do pedido de reenvio repetido: uma sessão nova por vez, gravada sem limpeza.
  for (let i = 0; i < times; i++) await new lib.SessionBuilder(a, toB).initOutgoing(bundle(b, 102));
  return { a, b, toB, record: a.records.get(toB.toString()) };
}

describe("retenção do registro de sessões Signal", () => {
  it("reproduz o crescimento: initOutgoing grava sem limpar", async () => {
    const { record } = await bloated(120);
    expect(record.getSessions().length).toBe(120);
  });

  it("remove exatamente as mesmas sessões que a libsignal removeria", async () => {
    const { record } = await bloated(120);
    const serialized = record.serialize();
    const { data, removed } = trimSessionRecord(serialized);
    const lib40 = lib.SessionRecord.deserialize(record.serialize());
    lib40.removeOldSessions();
    expect(removed).toBe(80);
    expect(Object.keys(data._sessions).sort()).toEqual(Object.keys(lib40.serialize()._sessions).sort());
    // a sessão aberta (a mais recente) continua
    const trimmed = lib.SessionRecord.deserialize(data);
    expect(trimmed.haveOpenSession()).toBe(true);
    expect(trimmed.getOpenSession().indexInfo.baseKey.toString("base64")).toBe(record.getOpenSession().indexInfo.baseKey.toString("base64"));
  });

  it("depois de cortar, a conversa continua: mensagem válida decifra e adulterada é rejeitada", async () => {
    const { a, b, toB, record } = await bloated(120);
    a.records.set(toB.toString(), lib.SessionRecord.deserialize(trimSessionRecord(record.serialize()).data));
    const packet = await new lib.SessionCipher(a, toB).encrypt(Buffer.from("oferta"));
    const fromA = new lib.ProtocolAddress("peer-a", 1);
    const plain = await new lib.SessionCipher(b, fromA).decryptPreKeyWhisperMessage(packet.body);
    expect(Buffer.from(plain).toString()).toBe("oferta");

    const second = await new lib.SessionCipher(a, toB).encrypt(Buffer.from("segunda"));
    const tampered = Buffer.from(second.body);
    tampered[tampered.length - 5] ^= 0xff;
    await expect(new lib.SessionCipher(b, fromA).decryptPreKeyWhisperMessage(tampered)).rejects.toThrow();
  });

  it("registro pequeno ou sem sessões fechadas fica intacto", () => {
    const small = { _sessions: { x: { indexInfo: { closed: 5 } } }, version: "v1" };
    expect(trimSessionRecord(small)).toEqual({ data: small, removed: 0 });
    const allOpen = { _sessions: Object.fromEntries(Array.from({ length: 45 }, (_, i) => [`k${i}`, { indexInfo: { closed: -1 } }])), version: "v1" };
    expect(trimSessionRecord(allOpen).removed).toBe(0);
    expect(trimSessionRecord(null).removed).toBe(0);
  });
});
