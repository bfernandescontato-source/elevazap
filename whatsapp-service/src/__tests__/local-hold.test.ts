import { mkdtempSync, writeFileSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isLocallyHeld, locallyHeldSessions } from "../senders/local-hold.js";

describe("espera local de números (contenção sem banco)", () => {
  it("lê um session_name por linha, ignora vazias e comentários, e acompanha mudanças", () => {
    const file = join(mkdtempSync(join(tmpdir(), "hold-")), "hold");
    writeFileSync(file, "# rosy\nsender_a\n\n sender_b \n");
    expect(Array.from(locallyHeldSessions(file)).sort()).toEqual(["sender_a", "sender_b"]);
    writeFileSync(file, "sender_c\n");
    utimesSync(file, new Date(), new Date(Date.now() + 5000));
    expect(isLocallyHeld("sender_a", file)).toBe(false);
    expect(isLocallyHeld("sender_c", file)).toBe(true);
  });

  it("sem arquivo, ninguém fica em espera", () => {
    expect(isLocallyHeld("sender_a", join(tmpdir(), "nao-existe-hold-" + Date.now()))).toBe(false);
  });

  it("o supervisor para e não sobe número em espera antes de falar com o banco", () => {
    const runtime = readFileSync(new URL("../senders/runtime.ts", import.meta.url), "utf8");
    const sync = runtime.slice(runtime.indexOf("export async function syncSenderSessionOwnership"));
    expect(sync.indexOf("isLocallyHeld")).toBeLessThan(sync.indexOf("acquire_whatsapp_session_leases"));
    const start = runtime.slice(runtime.indexOf("async function startSenderNow"));
    expect(start.slice(0, 300)).toContain("isLocallyHeld(sender.session_name)");
  });
});
