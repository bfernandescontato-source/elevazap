import { describe, expect, it } from "vitest";
import { compatibleQueueUpdate, type DatabaseCapabilities } from "../database-capabilities.js";

describe("compatibilidade com o banco existente", () => {
  it("mantém os campos de estabilidade quando a migração existe", () => {
    const capabilities: DatabaseCapabilities = {
      envios: { stabilityColumns: true },
      envios_grupo: { stabilityColumns: true }
    };
    expect(compatibleQueueUpdate(capabilities, "envios", { status: "sucesso", processing_deadline_at: null }))
      .toHaveProperty("processing_deadline_at");
  });

  it("remove somente campos ausentes em bancos anteriores", () => {
    const capabilities: DatabaseCapabilities = {
      envios: { stabilityColumns: false },
      envios_grupo: { stabilityColumns: false }
    };
    expect(compatibleQueueUpdate(capabilities, "envios", {
      status: "sucesso",
      processing_deadline_at: null,
      reconciliation_required: false,
      last_error_code: null
    })).toEqual({ status: "sucesso" });
  });
});
