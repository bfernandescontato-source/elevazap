import { describe, expect, it } from "vitest";
import { performance } from "node:perf_hooks";
import { createRequire } from "node:module";
import { addSignalEventLoopBreaks } from "../utils/signal-event-loop.js";

describe("Signal event-loop fairness", () => {
  it("lets a heartbeat run during a sustained series of failed attempts", async () => {
    const failure = new Error("Bad MAC");
    const prototype = { async doDecryptWhisperMessage() {
      const end = performance.now() + 0.2;
      while (performance.now() < end) { /* simulated crypto work */ }
      throw failure;
    } };
    const restore = addSignalEventLoopBreaks(prototype, 4);
    let complete = false;
    let heartbeatDuringWork = false;
    const timer = setTimeout(() => { heartbeatDuringWork = !complete; }, 0);
    try {
      for (let i = 0; i < 400; i++) {
        try { await prototype.doDecryptWhisperMessage(); }
        catch (error) { expect(error).toBe(failure); }
      }
      complete = true;
      expect(heartbeatDuringWork).toBe(true);
    } finally { clearTimeout(timer); restore(); }
  });

  it("preserves the receiver, arguments, result and rejection", async () => {
    const calls: unknown[] = [];
    const result = Buffer.from("plaintext");
    const failure = new Error("authentication failed");
    const prototype = { async doDecryptWhisperMessage(this: any, ...args: unknown[]) {
      calls.push([this, ...args]);
      if (args[0] === "fail") throw failure;
      return result;
    } };
    const restore = addSignalEventLoopBreaks(prototype, 0);
    const instance = Object.create(prototype);
    try {
      expect(await instance.doDecryptWhisperMessage("ok", 7)).toBe(result);
      await expect(instance.doDecryptWhisperMessage("fail")).rejects.toBe(failure);
      expect(calls).toEqual([[instance, "ok", 7], [instance, "fail"]]);
    } finally { restore(); }
  });

  it("decrypts real Signal messages and still rejects tampering", async () => {
    const require = createRequire(import.meta.url);
    const lib = createRequire(require.resolve("@whiskeysockets/baileys"))("libsignal");
    function storage(registrationId: number) {
      const identity = lib.curve.generateKeyPair();
      const signed = lib.curve.generateKeyPair();
      const prekey = lib.curve.generateKeyPair();
      const records = new Map();
      return {
        identity, signed, prekey,
        loadSession: async (id: string) => records.get(id),
        storeSession: async (id: string, record: unknown) => { records.set(id, record); },
        isTrustedIdentity: async () => true,
        getOurIdentity: async () => identity,
        getOurRegistrationId: async () => registrationId,
        loadSignedPreKey: async () => signed,
        loadPreKey: async () => prekey,
        removePreKey: async () => {},
      };
    }
    const alice = storage(101), bob = storage(102);
    const aliceAddress = new lib.ProtocolAddress("alice-test", 1);
    const bobAddress = new lib.ProtocolAddress("bob-test", 1);
    await new lib.SessionBuilder(alice, bobAddress).initOutgoing({
      registrationId: 102, identityKey: bob.identity.pubKey,
      signedPreKey: { keyId: 1, publicKey: bob.signed.pubKey,
        signature: lib.curve.calculateSignature(bob.identity.privKey, bob.signed.pubKey) },
      preKey: { keyId: 2, publicKey: bob.prekey.pubKey },
    });
    const restore = addSignalEventLoopBreaks(lib.SessionCipher.prototype, 0);
    const a = new lib.SessionCipher(alice, bobAddress), b = new lib.SessionCipher(bob, aliceAddress);
    try {
      const first = await a.encrypt(Buffer.from("first"));
      expect((await b.decryptPreKeyWhisperMessage(first.body)).toString()).toBe("first");
      const reply = await b.encrypt(Buffer.from("reply"));
      expect((await a.decryptWhisperMessage(reply.body)).toString()).toBe("reply");
      const next = await a.encrypt(Buffer.from("next"));
      expect((await b.decryptWhisperMessage(next.body)).toString()).toBe("next");
      const bad = await a.encrypt(Buffer.from("tampered"));
      bad.body[bad.body.length - 1] ^= 1;
      await expect(b.decryptWhisperMessage(bad.body)).rejects.toThrow();
    } finally { restore(); }
  });

  it("isola números: decifrar em paralelo com pausas não mistura estado nem resultados", async () => {
    const require = createRequire(import.meta.url);
    const lib = createRequire(require.resolve("@whiskeysockets/baileys"))("libsignal");
    const quiet = { info: console.info, warn: console.warn, error: console.error };
    console.info = console.warn = console.error = () => undefined;
    function storage(registrationId: number) {
      const identity = lib.curve.generateKeyPair(), signed = lib.curve.generateKeyPair(), prekey = lib.curve.generateKeyPair();
      const records = new Map();
      return { identity, signed, prekey,
        loadSession: async (id: string) => records.get(id), storeSession: async (id: string, r: unknown) => { records.set(id, r); },
        isTrustedIdentity: async () => true, getOurIdentity: async () => identity, getOurRegistrationId: async () => registrationId,
        loadSignedPreKey: async () => signed, loadPreKey: async () => prekey, removePreKey: async () => {} };
    }
    const bundle = (s: any, id: number) => ({ registrationId: id, identityKey: s.identity.pubKey,
      signedPreKey: { keyId: 1, publicKey: s.signed.pubKey, signature: lib.curve.calculateSignature(s.identity.privKey, s.signed.pubKey) },
      preKey: { keyId: 2, publicKey: s.prekey.pubKey } });
    // dois "números" (receptores) diferentes, cada um com seu remetente
    const pairs = await Promise.all([1, 2].map(async (n) => {
      const sender = storage(300 + n), receiver = storage(400 + n);
      const toReceiver = new lib.ProtocolAddress(`receiver-${n}`, 1), toSender = new lib.ProtocolAddress(`sender-${n}`, 1);
      await new lib.SessionBuilder(sender, toReceiver).initOutgoing(bundle(receiver, 400 + n));
      const enc = new lib.SessionCipher(sender, toReceiver), dec = new lib.SessionCipher(receiver, toSender);
      return { n, enc, dec };
    }));
    const restore = addSignalEventLoopBreaks(lib.SessionCipher.prototype, 0);
    try {
      const firsts = await Promise.all(pairs.map((p) => p.enc.encrypt(Buffer.from(`oi ${p.n}`))));
      const opened = await Promise.all(pairs.map((p, i) => p.dec.decryptPreKeyWhisperMessage(firsts[i].body)));
      expect(opened.map((b: Buffer) => b.toString())).toEqual(["oi 1", "oi 2"]);
      // resposta fecha o handshake: daqui em diante são mensagens normais (whisper)
      for (const p of pairs) await p.enc.decryptWhisperMessage((await p.dec.encrypt(Buffer.from("ok"))).body);
      // número 1 recebe mensagem adulterada ao mesmo tempo em que o número 2 recebe 20 válidas
      const bad = await pairs[0].enc.encrypt(Buffer.from("x")); bad.body[bad.body.length - 1] ^= 1;
      const goods = [];
      for (let i = 0; i < 20; i++) goods.push(await pairs[1].enc.encrypt(Buffer.from(`m${i}`)));
      const [badResult, ...goodResults] = await Promise.allSettled([
        pairs[0].dec.decryptWhisperMessage(bad.body),
        ...goods.map((g) => pairs[1].dec.decryptWhisperMessage(g.body))
      ]);
      expect(badResult.status).toBe("rejected");
      expect(goodResults.map((r: any) => r.status === "fulfilled" ? r.value.toString() : "ERRO")).toEqual(goods.map((_, i) => `m${i}`));
      // o número 1 continua funcionando depois do erro
      const after = await pairs[0].enc.encrypt(Buffer.from("depois"));
      expect((await pairs[0].dec.decryptWhisperMessage(after.body)).toString()).toBe("depois");
    } finally { restore(); Object.assign(console, quiet); }
  });
});
