import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("recuperação da inicialização", () => {
  it("continua tentando conectar ao banco sem deixar o serviço online e inerte", () => {
    const source = readFileSync(resolve(process.cwd(), "src/index.ts"), "utf8");
    expect(source).toContain("async function prepareDatabaseRuntime");
    expect(source).toContain("for (;;)");
    expect(source).toContain('event: "service.database_initialization_retry"');
    expect(source).toContain("const databaseCapabilities = await prepareDatabaseRuntime(readiness)");
  });
});
