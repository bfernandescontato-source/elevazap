import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(process.cwd(), "..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

describe("fila e configuração do Piloto Automático", () => {
  it("limita atomicamente a cinco ofertas e libera vagas nos estados finais", () => {
    const migration = read("supabase/migrations/20260903153000_limit_pilot_queue_and_atomic_config.sql");
    expect(migration).toContain("active_queue_count < 5");
    expect(migration).toContain("active_queue_count = greatest(active_queue_count - 1, 0)");
    expect(migration).toContain("PILOT_QUEUE_FULL");
    expect(migration).toContain("before insert or update of status");
  });

  it("salva configuração e grupos em uma única operação", () => {
    const migration = read("supabase/migrations/20260903153000_limit_pilot_queue_and_atomic_config.sql");
    const service = read("web/modules/offer-autopilot/server/service.ts");
    expect(migration).toContain("save_offer_autopilot_configuration");
    expect(migration).toContain("on conflict (automation_id, whatsapp_group_id) do update");
    expect(service).toContain('database.rpc("save_offer_autopilot_configuration"');
    expect(service).not.toContain('from("automation_source_groups").delete()');
  });

  it("mantém os textos do painel simples", () => {
    const page = read("web/app/piloto-automatico/page.tsx");
    expect(page).toContain("A fila está cheia. Novas ofertas não serão adicionadas.");
    expect(page).toContain("Não entrou porque a fila estava cheia.");
    expect(page).toContain("Tentar novamente");
  });
});
