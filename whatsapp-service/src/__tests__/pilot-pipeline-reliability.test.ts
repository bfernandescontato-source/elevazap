import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { retryDelay } from "../queue/policy.js";

const root = resolve(process.cwd(), "..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

describe("confiabilidade do fluxo completo do Piloto", () => {
  it("retenta erro temporário e encerra após o máximo de tentativas", () => {
    expect(retryDelay(1)).toBeGreaterThan(0);
    expect(retryDelay(2)).toBeGreaterThan(retryDelay(1) || 0);
    expect(retryDelay(3)).toBeNull();
  });

  it("recupera claim expirado do envio sem reenviar resultado incerto", () => {
    const recovery = read("whatsapp-service/src/recovery.ts");
    expect(recovery).toContain('status: "pendente"');
    expect(recovery).toContain('status: "incerto"');
    expect(recovery).toContain('last_error_code: "PROCESSING_DEADLINE_EXCEEDED"');
  });

  it("confirma envio uma única vez com token de fencing", () => {
    const queueMigration = read("supabase/migrations/20260826185623_sender_fair_queue.sql");
    expect(queueMigration).toContain("e.claim_token=p_claim_token");
    expect(queueMigration).toContain("claim_token=null");
    expect(queueMigration).toContain("return changed=1");
  });

  it("cancela scheduled e waiting ao desligar e só monitora automações ligadas", () => {
    const stopMigration = read("supabase/migrations/20260908165112_definitive_pilot_waiting_queue.sql");
    const monitor = read("whatsapp-service/src/offers/whatsapp-monitor.ts");
    expect(stopMigration).toContain("old.enabled is distinct from new.enabled");
    expect(stopMigration).toContain("'captured','processing','ready','waiting','scheduled'");
    expect(stopMigration).toContain("pilot_next_slot_at=null");
    expect(monitor).toContain('.eq("whatsapp_sender_id", sender.id).eq("enabled", true)');
  });

  it("mantém backlog persistente com cinco agendamentos físicos", () => {
    const migration = read("supabase/migrations/20260908165112_definitive_pilot_waiting_queue.sql");
    const processor = read("whatsapp-service/src/offers/offer-processor.ts");
    expect(migration).toContain("status = 'waiting'");
    expect(processor).not.toContain("queue_limit: 5");
    expect(processor).not.toContain("offer_ignored_queue_full");
  });

  it("impede worker com lease vencido e adota agendamento parcial anterior", () => {
    const migration = read("supabase/migrations/20260908165112_definitive_pilot_waiting_queue.sql");
    const processor = read("whatsapp-service/src/offers/offer-processor.ts");
    expect(migration).toContain("v_offer.processing_worker_id is distinct from p_worker_id");
    expect(migration).toContain("v_offer.processing_deadline_at <= now()");
    expect(migration).toContain("if v_existing_delivery_count > 0 then");
    expect(processor).toContain('p_worker_id: env.INSTANCE_ID');
    expect(processor).toContain('.eq("processing_worker_id", env.INSTANCE_ID)');
  });

  it("não bloqueia o boot da fila durante recuperação lenta do Piloto", () => {
    const index = read("whatsapp-service/src/index.ts");
    const queueStarted = index.indexOf("queue.start()");
    const recoveryStarted = index.indexOf("void recoverInterruptedPilotOffers()");
    expect(queueStarted).toBeGreaterThan(-1);
    expect(recoveryStarted).toBeGreaterThan(queueStarted);
    expect(index).not.toContain("await recoverInterruptedPilotOffers()");
  });

  it("impede duas recuperações do Piloto de rodarem simultaneamente", () => {
    const recovery = read("whatsapp-service/src/offers/offer-recovery.ts");
    expect(recovery).toContain("if (activeRecovery) return activeRecovery");
    expect(recovery).toContain("activeRecovery = runInterruptedPilotRecovery().finally");
  });

  it("aceita oferta enviada pelo próprio número em grupo fonte sem criar ciclo no destino", () => {
    const monitor = read("whatsapp-service/src/offers/whatsapp-monitor.ts");
    expect(monitor).not.toContain('groupId.endsWith("@g.us") || incoming?.key?.fromMe');
    expect(monitor).toContain('database.from("automation_destinations")');
    expect(monitor).toContain("automationIds.filter((automationId) => !loopRisk.has(automationId))");
  });

  it("registra metadados não sensíveis antes dos filtros de captura", () => {
    const runtime = read("whatsapp-service/src/senders/runtime.ts");
    expect(runtime).toContain('event: "pilot_group_messages_observed"');
    expect(runtime).toContain("upsert_type: upsertType");
    expect(runtime).toContain("group_ids:");
    expect(runtime).not.toContain("original_text:");
  });
});
