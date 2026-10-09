import { createRequire } from "node:module";
import { performance } from "node:perf_hooks";

type DecryptPrototype = {
  doDecryptWhisperMessage: (this: any, ...args: any[]) => Promise<any>;
};

/** Share a CPU budget across all sessions, including failed key attempts. */
export function addSignalEventLoopBreaks(prototype: DecryptPrototype, budgetMs = 8) {
  const original = prototype.doDecryptWhisperMessage;
  let deadline = performance.now() + budgetMs;
  let pending: Promise<void> | undefined;
  const wrapped: DecryptPrototype["doDecryptWhisperMessage"] = function (...args) {
    if (!pending && performance.now() >= deadline) {
      pending = new Promise<void>((resolve) => setImmediate(() => {
        deadline = performance.now() + budgetMs;
        pending = undefined;
        resolve();
      }));
    }
    // Preserve libsignal's key ordering, results and rejections. Only allow
    // timers and socket I/O to run between attempts; never skip old keys.
    return pending
      ? pending.then(() => original.apply(this, args))
      : original.apply(this, args);
  };
  prototype.doDecryptWhisperMessage = wrapped;
  return () => {
    if (prototype.doDecryptWhisperMessage === wrapped) prototype.doDecryptWhisperMessage = original;
  };
}

let installed = false;
export function installSignalEventLoopBreaks() {
  if (installed || process.env.SIGNAL_EVENT_LOOP_BREAKS === "false") return;
  const require = createRequire(import.meta.url);
  // Resolve the exact libsignal used by Baileys, even if npm nests it.
  const baileysRequire = createRequire(require.resolve("@whiskeysockets/baileys"));
  const { SessionCipher } = baileysRequire("libsignal") as { SessionCipher: { prototype: DecryptPrototype } };
  if (typeof SessionCipher?.prototype?.doDecryptWhisperMessage !== "function") {
    throw new Error("Unsupported libsignal: decrypt method not found.");
  }
  addSignalEventLoopBreaks(SessionCipher.prototype);
  installed = true;
}
