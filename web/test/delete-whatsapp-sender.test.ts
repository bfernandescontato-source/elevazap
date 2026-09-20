import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(__dirname, "../..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");
const normalize = (sql: string) => sql.replace(/--.*$/gm, "").replace(/\s+/g, " ").toLowerCase();

describe("exclusão de número do WhatsApp", () => {
  const migration = normalize(read("supabase/migrations/20260919233000_delete_whatsapp_sender_without_rewriting_history.sql"));

  it("não reescreve o histórico: remove as chaves estrangeiras das tabelas de histórico", () => {
    for (const constraint of [
      "envios_grupo_whatsapp_sender_id_fkey", "envios_grupo_whatsapp_session_id_fkey",
      "envios_grupo_lotes_whatsapp_sender_id_fkey", "envios_grupo_lotes_whatsapp_session_id_fkey",
      "envios_whatsapp_sender_id_fkey", "envios_whatsapp_session_id_fkey",
      "group_participant_syncs_whatsapp_sender_id_fkey"
    ]) expect(migration).toContain(`drop constraint if exists ${constraint}`);
    // A função nova não pode voltar a reescrever milhares de linhas com set ... = null.
    expect(migration).not.toMatch(/update public\.envios_grupo set whatsapp_sender_id = null/);
    expect(migration).not.toContain("loop");
  });

  it("fecha a execução para anon e authenticated (as funções confiam em p_account_id)", () => {
    for (const fn of ["delete_whatsapp_sender(uuid, uuid)", "cancel_whatsapp_sender_pending_work(uuid, uuid)", "cancel_whatsapp_sender_pending_batches(uuid, uuid)"]) {
      expect(migration).toContain(`revoke all on function public.${fn} from public, anon, authenticated`);
      expect(migration).toContain(`grant execute on function public.${fn} to service_role`);
    }
  });

  it("a rota do painel chama as três etapas em sequência, cada uma em sua transação", () => {
    const route = read("web/app/api/whatsapp/senders/[id]/route.ts");
    const order = ["cancel_whatsapp_sender_pending_work", "cancel_whatsapp_sender_pending_batches", "delete_whatsapp_sender"];
    const positions = order.map((name) => route.indexOf(`"${name}"`));
    expect(positions.every((position) => position > -1)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    expect(route).toContain("supabaseAdmin()");
  });
});
