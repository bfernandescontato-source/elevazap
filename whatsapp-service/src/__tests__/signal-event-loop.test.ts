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
});
