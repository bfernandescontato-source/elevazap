import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(process.cwd(), "..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

describe("confiabilidade do estado criptográfico do WhatsApp", () => {
  it("ordena operações, mantém cache e não converte falha de infraestrutura em chave ausente", () => {
    const authStore = read("whatsapp-service/src/auth/supabase-auth-state.ts");
    expect(authStore).toContain("withAuthOperationLock");
    expect(authStore).toContain("makeCacheableSignalKeyStore");
    expect(authStore).toContain("throw error;");
  });

  it("aguarda gravações pendentes antes de substituir uma sessão", () => {
    const authStore = read("whatsapp-service/src/auth/supabase-auth-state.ts");
    const session = read("whatsapp-service/src/whatsapp/session.ts");
    const runtime = read("whatsapp-service/src/senders/runtime.ts");
    expect(authStore).toContain("waitForIdle");
    expect(session).toContain("await auth.waitForIdle()");
    expect(runtime).toContain("await current.session.stop()");
  });
});
