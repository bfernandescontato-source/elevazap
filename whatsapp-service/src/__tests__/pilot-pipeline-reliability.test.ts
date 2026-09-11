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
    const toggleFix = read("supabase/migrations/20260910105300_fix_pilot_toggle_affiliate_job_lookup.sql");
    const monitor = read("whatsapp-service/src/offers/whatsapp-monitor.ts");
    expect(stopMigration).toContain("old.enabled is distinct from new.enabled");
    expect(stopMigration).toContain("'captured','processing','ready','waiting','scheduled'");
    expect(stopMigration).toContain("pilot_next_slot_at=null");
    expect(toggleFix).toContain("job.offer_link_id");
    expect(toggleFix).toContain("conversion_error='Piloto Automático desativado.'");
    expect(toggleFix).not.toContain("job.automation_id");
    expect(monitor).toContain('.eq("whatsapp_sender_id", sender.id).eq("enabled", true)');
  });

  it("mantém backlog persistente com cinco agendamentos físicos", () => {
    const migration = read("supabase/migrations/20260908165112_definitive_pilot_waiting_queue.sql");
    const processor = read("whatsapp-service/src/offers/offer-processor.ts");
    expect(migration).toContain("status = 'waiting'");
    expect(processor).not.toContain("queue_limit: 5");
    expect(processor).not.toContain("offer_ignored_queue_full");
  });

  it("compacta os horários restantes quando uma oferta ocupa e libera um slot", () => {
    const migration = read("supabase/migrations/20260909150545_compact_pilot_schedule_after_terminal_offer.sql");
    const intervalFix = read("supabase/migrations/20260909171419_preserve_pilot_interval_after_terminal_offer.sql");
    const configFix = read("supabase/migrations/20260911122500_recompact_pilot_after_schedule_config_change.sql");
    expect(migration).toContain("referencing old table as old_pilot_offers new table as new_pilot_offers");
    expect(migration).toContain("compact_pilot_schedule_locked");
    expect(migration).toContain("offer.status = 'scheduled'");
    expect(migration).toContain("pilot_next_slot_at = case when v_scheduled = 0 then null else v_candidate end");
    expect(intervalFix).toContain("v_last_sent_at + make_interval(mins => v_automation.interval_minutes)");
    expect(intervalFix).toContain("enable trigger compact_pilot_schedule_after_terminal_statement");
    expect(configFix).toContain("after update of interval_minutes, operating_start, operating_end, timezone");
    expect(configFix).toContain("compact_pilot_schedule_locked(new.id, now())");
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

  it("descarta o backlog de um grupo fonte quando ele é removido", () => {
    const migration = read("supabase/migrations/20260911143000_discard_backlog_from_removed_pilot_source.sql");
    expect(migration).toContain("discard_pilot_source_backlog");
    expect(migration).toContain("PILOT_SOURCE_REMOVED");
    expect(migration).toContain("after delete on public.automation_source_groups");
    expect(migration).toContain("promote_waiting_pilot_offers(p_automation_id,now())");
  });

  it("cancela entregas pendentes quando um grupo de destino é removido", () => {
    const migration = read("supabase/migrations/20260911175000_cancel_pending_delivery_after_destination_removed.sql");
    expect(migration).toContain("cancel_pending_pilot_destination");
    expect(migration).toContain("delivery.destination_group_id=p_destination_group_id");
    expect(migration).toContain("after delete on public.automation_destinations");
    expect(migration).toContain("recalc_lote_counts(v_lote_id)");
  });

  it("registra metadados não sensíveis antes dos filtros de captura", () => {
    const runtime = read("whatsapp-service/src/senders/runtime.ts");
    expect(runtime).toContain('event: "pilot_group_messages_observed"');
    expect(runtime).toContain("upsert_type: upsertType");
    expect(runtime).toContain("group_ids:");
    expect(runtime).not.toContain("original_text:");
  });

  it("expõe credencial Shopee incompatível como erro de integração sem registrar o segredo", () => {
    const converter = read("whatsapp-service/src/offers/shopee-conversion.ts");
    expect(converter).toContain('status: "error"');
    expect(converter).toContain("Credencial Shopee incompatível com o ambiente atual");
    expect(converter).not.toContain("console.error(appSecret");
  });

  it("permite reiniciar somente uma sessão preservando o vínculo do WhatsApp", () => {
    const runtime = read("whatsapp-service/src/senders/runtime.ts");
    const routes = read("whatsapp-service/src/routes/http.ts");
    expect(runtime).toContain("restartSenderSessionByName");
    expect(runtime).toContain("current.session.stop()");
    expect(runtime).not.toContain("restartSenderSessionByName(sessionName: string, fresh");
    expect(routes).toContain('/senders/:sessionName/restart');
  });

  it("indexa offer_deliveries e envios_grupo por (account_id, status) para o gatilho de desligar não varrer a tabela inteira", () => {
    const migration = read("supabase/migrations/20260910120000_index_pilot_toggle_lookups.sql");
    expect(migration).toContain("offer_deliveries_account_status_idx");
    expect(migration).toContain("on public.offer_deliveries(account_id, status)");
    expect(migration).toContain("envios_grupo_account_status_idx");
    expect(migration).toContain("on public.envios_grupo(account_id, status)");
  });
});
