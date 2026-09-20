import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(__dirname, "../..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");
const normalize = (sql: string) => sql.replace(/--.*$/gm, "").replace(/\s+/g, " ").toLowerCase();

describe("limpeza da lista de grupos ao atualizar", () => {
  const migration = normalize(read("supabase/migrations/20260920010000_prune_sender_groups_on_refresh.sql"));

  it("não apaga nada quando a leitura veio vazia", () => {
    expect(migration).toContain("if p_group_jids is null or cardinality(p_group_jids) = 0 then return 0");
  });

  it("remove da lista do número e dos destinos do Piloto só o que não veio na leitura", () => {
    expect(migration).toContain("delete from public.whatsapp_sender_grupos where account_id = p_account_id and whatsapp_sender_id = p_sender_id and group_jid <> all (p_group_jids)");
    expect(migration).toContain("delete from public.automation_destinations destination");
    expect(migration).toContain("destination.whatsapp_group_id <> all (p_group_jids)");
    // origens ficam de fora: trocar de origem é decisão do cliente
    expect(migration).not.toContain("delete from public.automation_source_groups");
  });

  it("só o service_role executa (a função confia em p_account_id)", () => {
    expect(migration).toContain("revoke all on function public.prune_sender_groups(uuid, uuid, text[]) from public, anon, authenticated");
    expect(migration).toContain("grant execute on function public.prune_sender_groups(uuid, uuid, text[]) to service_role");
  });

  it("a rota de atualizar grupos só limpa depois de gravar a leitura nova", () => {
    const route = read("web/app/api/whatsapp/senders/[id]/refresh-groups/route.ts");
    const upsert = route.indexOf(".upsert(");
    const prune = route.indexOf('"prune_sender_groups"');
    expect(upsert).toBeGreaterThan(-1);
    expect(prune).toBeGreaterThan(upsert);
    expect(route).toContain("if (groups.length)");
  });
});
