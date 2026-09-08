import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(process.cwd(), "..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

describe("fila e configuração do Piloto Automático", () => {
  it("preserva todo o backlog e agenda cada oferta atomicamente", () => {
    const migration = read("supabase/migrations/20260908165112_definitive_pilot_waiting_queue.sql");
    expect(migration).toContain("create or replace function public.schedule_pilot_offer");
    expect(migration).toContain("for update;");
    expect(migration).toContain("v_offer.processing_worker_id is distinct from p_worker_id");
    expect(migration).toContain("v_automation.operating_start >= v_automation.operating_end");
    expect(migration).toContain("'pilot:' || v_offer.id::text");
    expect(migration).toContain("v_slots >= 5");
    expect(migration).toContain("status='waiting'");
  });

  it("retoma processamento interrompido com claim concorrente e prazo", () => {
    const migration = read("supabase/migrations/20260908165112_definitive_pilot_waiting_queue.sql");
    const recovery = read("whatsapp-service/src/offers/offer-recovery.ts");
    expect(migration).toContain("create or replace function public.claim_interrupted_pilot_offers");
    expect(migration).toContain("for update of offer skip locked");
    expect(migration).toContain("offer.processing_deadline_at < now()");
    expect(recovery).toContain('rpc("claim_interrupted_pilot_offers"');
    expect(recovery).toContain("processor.resume");
  });

  it("torna o agendamento repetido idempotente e não duplica destinos", () => {
    const migration = read("supabase/migrations/20260908165112_definitive_pilot_waiting_queue.sql");
    expect(migration).toContain("if v_offer.status in ('waiting', 'scheduled', 'sending', 'sent') then");
    expect(migration).toContain("if v_existing_delivery_count > 0 then");
    expect(migration).toContain("'already_scheduled', true");
    expect(migration).toContain("'pilot:' || v_offer.id::text || ':' || destination.whatsapp_group_id");
  });

  it("recupera somente processing atual e nunca toca na quarentena", () => {
    const migration = read("supabase/migrations/20260908165112_definitive_pilot_waiting_queue.sql");
    expect(migration).toContain("offer.status='processing'");
    expect(migration).toContain("offer.captured_at >= automation.pilot_reset_at");
    expect(migration).toContain("offer.queue_quarantined_at is null");
    expect(migration).toContain("offer.error_code is distinct from 'PILOT_QUEUE_QUARANTINED'");
  });

  it("salva configuração e grupos em uma única operação", () => {
    const migration = read("supabase/migrations/20260903153000_limit_pilot_queue_and_atomic_config.sql");
    const service = read("web/modules/offer-autopilot/server/service.ts");
    expect(migration).toContain("save_offer_autopilot_configuration");
    expect(migration).toContain("on conflict (automation_id, whatsapp_group_id) do update");
    expect(service).toContain('database.rpc("save_offer_autopilot_configuration"');
    expect(service).not.toContain('from("automation_source_groups").delete()');
  });

  it("sincroniza entregas do Piloto em qualquer caminho que finalize um disparo", () => {
    const migration = read("supabase/migrations/20260908165112_definitive_pilot_waiting_queue.sql");
    expect(migration).toContain("promote_waiting_after_pilot_terminal");
    expect(migration).toContain("perform public.promote_waiting_pilot_offers");
    expect(migration).toContain("for update skip locked");
  });

  it("mantém os textos do painel simples", () => {
    const page = read("web/app/piloto-automatico/page.tsx");
    expect(page).not.toContain("A fila está cheia. Novas ofertas não serão adicionadas.");
    expect(page).toContain("Aguardando uma vaga");
    expect(page).not.toContain("PILOT_QUEUE_FULL");
  });
});
