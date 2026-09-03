import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { localDateTimeToIso } from "../lib/timezone";

const workspaceRoot = resolve(import.meta.dirname, "../..");

describe("horário de disparos oficiais", () => {
  it("converte horário civil de Brasília para UTC", () => {
    expect(localDateTimeToIso("2026-09-03", "19:30", "America/Sao_Paulo")).toBe("2026-09-03T22:30:00.000Z");
  });

  it("rejeita datas inexistentes em vez de normalizá-las silenciosamente", () => {
    expect(localDateTimeToIso("2026-02-30", "10:00", "America/Sao_Paulo")).toBeNull();
    expect(localDateTimeToIso("2026-09-03", "25:00", "America/Sao_Paulo")).toBeNull();
  });
});

describe("garantias persistentes do agendador oficial", () => {
  const migration = readFileSync(resolve(workspaceRoot, "supabase/migrations/20260904001000_harden_official_broadcast_scheduling.sql"), "utf8");
  const scheduler = readFileSync(resolve(workspaceRoot, "web/modules/official-whatsapp/server/broadcasts.ts"), "utf8");

  it("cria disparo e destinatários na mesma transação", () => {
    expect(migration).toContain("create_official_broadcast_with_recipients");
    expect(scheduler).toContain('admin.rpc("create_official_broadcast_with_recipients"');
  });

  it("reserva lotes com trava de banco e SKIP LOCKED", () => {
    expect(migration).toContain("claim_official_broadcast_batch");
    expect(migration).toContain("for update skip locked");
    expect(scheduler).toContain('admin.rpc("claim_official_broadcast_batch"');
  });

  it("não reenvia automaticamente uma entrega cujo resultado ficou incerto", () => {
    expect(migration).toContain("UNCERTAIN_DELIVERY");
    expect(migration).toContain("status = 'failed'");
  });

  it("recupera disparos processing abandonados pelo próprio cron", () => {
    expect(migration).toContain("claim_due_official_broadcasts");
    expect(migration).toContain("worker_lease_until");
    expect(scheduler).toContain('admin.rpc("claim_due_official_broadcasts"');
  });

  it("propaga respostas HTTP malsucedidas do encadeamento", () => {
    expect(scheduler).toContain("if (!response.ok) throw new Error");
  });
});
