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
});
