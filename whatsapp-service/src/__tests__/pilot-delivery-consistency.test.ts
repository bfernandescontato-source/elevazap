import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const queue = readFileSync(new URL("../queue/queue.ts", import.meta.url), "utf8");
const migration = readFileSync(new URL("../../../supabase/migrations/20261009230000_pilot_delivery_guard.sql", import.meta.url), "utf8");
const sync = queue.slice(queue.indexOf("private async syncOfferDelivery("), queue.indexOf("private async recalc("));

describe("consistência oferta x envio do Piloto (09/10)", () => {
  it("o serviço não grava mais o status da entrega nem da oferta (o gatilho do banco é a única fonte)", () => {
    expect(sync).not.toMatch(/update\(\s*\{[^}]*status/);
    expect(sync).not.toContain('from("captured_offers")');
    // só complementa o erro da nova tentativa, e só se a entrega ainda estiver aguardando
    expect(sync).toContain('.eq("status", "scheduled")');
  });

  it("trava no banco: entrega de envio já terminado não volta para scheduled/sending", () => {
    expect(migration).toContain("before update of status on public.offer_deliveries");
    expect(migration).toMatch(/if v_status in \('sucesso', 'erro', 'incerto', 'cancelado'\)/);
    expect(migration).toContain("when 'incerto' then 'uncertain'");
  });

  it("reconciliação em lotes pequenos, sem criar nem reenviar mensagens", () => {
    expect(migration).toContain("p_limit not between 1 and 100");
    expect(migration).toContain("for update of delivery skip locked");
    expect(migration).not.toMatch(/insert into public\.envios_grupo/i);
    expect(migration).not.toMatch(/update public\.envios_grupo/i);
  });
});
