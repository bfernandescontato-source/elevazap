import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const migration = readFileSync(
  resolve(__dirname, "../../supabase/migrations/20260919230000_index_offer_deliveries_pending_destination.sql"),
  "utf8"
);

describe("remoção de destino do Piloto", () => {
  it("mantém o índice parcial que evita estourar o timeout do PostgREST ao salvar", () => {
    const sql = migration.replace(/--.*$/gm, "").replace(/\s+/g, " ").trim().toLowerCase();
    expect(sql).toContain("create index if not exists offer_deliveries_pending_destination_idx");
    // destination_group_id precisa ser a primeira coluna: cancel_pending_pilot_destination filtra por ela sem offer_id.
    expect(sql).toContain("on public.offer_deliveries (destination_group_id, account_id)");
    expect(sql).toContain("where status in ('pending', 'scheduled')");
  });
});
