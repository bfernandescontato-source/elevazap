import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { describeCapacity, describeLateQueue, estimateCapacity, SECONDS_PER_GROUP_MESSAGE, smallestIntervalMinutes } from "../modules/dispatch-capacity/capacity";
import { membershipByGroup, splitGroupsAcrossSenders } from "../modules/dispatch-capacity/split";

describe("estimativa de capacidade", () => {
  it("caso real: 42 grupos, 1 número, 1 oferta a cada 5 minutos atrasa", () => {
    const estimate = estimateCapacity({ groupsPerOffer: 42, intervalMinutes: 5 });
    expect(SECONDS_PER_GROUP_MESSAGE).toBe(17);
    expect(Math.round(estimate.minutesPerOffer)).toBe(12);
    expect(estimate.queueGrows).toBe(true);
    expect(estimate.safeIntervalMinutes).toBe(15);
    expect(estimate.sendersNeeded).toBe(3);
    const message = describeCapacity(estimate, { pilot: true, canSplit: true })!;
    expect(message.tone).toBe("warning");
    expect(message.lines[0]).toBe("Cada oferta leva uns 12 minutos para chegar nos 42 grupos com 1 número.");
    expect(message.lines[1]).toBe("Com 1 oferta a cada 5 minutos a fila vai atrasar.");
    expect(message.lines.join(" ")).toContain("divida os grupos entre 3 números");
    expect(message.lines.join(" ")).toContain("2 horas é descartada");
  });

  it("com 3 números dividindo, cada um manda 14 grupos e a fila anda em dia", () => {
    const estimate = estimateCapacity({ groupsPerOffer: 42, intervalMinutes: 5, senders: 3 });
    expect(estimate.groupsPerSender).toBe(14);
    expect(estimate.minutesPerOffer).toBeCloseTo(3.97, 1);
    expect(estimate.queueGrows).toBe(false);
    expect(describeCapacity(estimate)!.tone).toBe("ok");
  });

  it("divisão desigual usa o número mais carregado", () => {
    const estimate = estimateCapacity({ groupsPerOffer: 42, intervalMinutes: 5, senders: 3, largestShare: 30 });
    expect(estimate.groupsPerSender).toBe(30);
    expect(estimate.queueGrows).toBe(true);
  });

  it("sem grupos não avisa nada e entradas ruins não quebram", () => {
    expect(describeCapacity(estimateCapacity({ groupsPerOffer: 0, intervalMinutes: 5 }))).toBeNull();
    const estimate = estimateCapacity({ groupsPerOffer: 10, intervalMinutes: 0, senders: 0 });
    expect(estimate.senders).toBe(1);
    expect(estimate.intervalMinutes).toBe(1);
    expect(estimate.queueGrows).toBe(true);
  });

  it("textos sem travessão nem hífen como pontuação", () => {
    const message = describeCapacity(estimateCapacity({ groupsPerOffer: 300, intervalMinutes: 1 }), { pilot: true, canSplit: true })!;
    for (const line of [message.title, ...message.lines]) expect(line).not.toMatch(/[—–]| - /);
    expect(message.lines[1]).toBe("Com 1 oferta por minuto a fila vai atrasar.");
  });

  it("menor intervalo de uma agenda", () => {
    const at = (minutes: number) => new Date(Date.UTC(2026, 10, 6, 10, minutes));
    expect(smallestIntervalMinutes([at(0)])).toBeNull();
    expect(smallestIntervalMinutes([at(30), at(0), at(10)])).toBe(10);
  });
});

describe("dividir grupos entre números", () => {
  const A = "sender-a", B = "sender-b", C = "sender-c";

  it("nunca dá um grupo a número que não está nele", () => {
    const groups = membershipByGroup([
      { whatsapp_sender_id: A, group_jid: "1@g.us" }, { whatsapp_sender_id: B, group_jid: "1@g.us" },
      { whatsapp_sender_id: A, group_jid: "2@g.us" },
      { whatsapp_sender_id: A, group_jid: "3@g.us" }, { whatsapp_sender_id: C, group_jid: "3@g.us" },
      { whatsapp_sender_id: B, group_jid: "4@g.us" }
    ], ["1@g.us", "2@g.us", "3@g.us", "4@g.us"]);
    const result = splitGroupsAcrossSenders({ groups, primarySenderId: A, availableSenderIds: [B, C] });
    const membersOf = new Map(groups.map((group) => [group.groupJid, group.memberSenderIds]));
    for (const [sender, jids] of result.assignments) for (const jid of jids) expect(membersOf.get(jid)).toContain(sender);
    expect(result.assignments.get(A)).toContain("2@g.us");
    expect(result.assignments.get(B)).toContain("4@g.us");
  });

  it("equilibra 42 grupos compartilhados por 3 números", () => {
    const jids = Array.from({ length: 42 }, (_, index) => `${String(index).padStart(2, "0")}@g.us`);
    const rows = jids.flatMap((jid) => [A, B, C].map((sender) => ({ whatsapp_sender_id: sender, group_jid: jid })));
    const result = splitGroupsAcrossSenders({ groups: membershipByGroup(rows, jids), primarySenderId: A, availableSenderIds: [B, C] });
    expect(result.shares).toEqual([{ senderId: A, groups: 14 }, { senderId: B, groups: 14 }, { senderId: C, groups: 14 }]);
    expect(result.largestShare).toBe(14);
    expect(result.sendersUsed).toBe(3);
  });

  it("número desconectado (fora da lista) não recebe grupos", () => {
    const rows = ["1@g.us", "2@g.us"].flatMap((jid) => [A, B].map((sender) => ({ whatsapp_sender_id: sender, group_jid: jid })));
    const result = splitGroupsAcrossSenders({ groups: membershipByGroup(rows, ["1@g.us", "2@g.us"]), primarySenderId: A, availableSenderIds: [] });
    expect(result.assignments.get(A)).toEqual(["1@g.us", "2@g.us"]);
    expect(result.assignments.has(B)).toBe(false);
  });

  it("grupo sem nenhum número disponível fica com o principal e grupos repetidos contam uma vez", () => {
    const result = splitGroupsAcrossSenders({
      groups: [{ groupJid: "x@g.us", memberSenderIds: [] }, { groupJid: "x@g.us", memberSenderIds: [] }],
      primarySenderId: A, availableSenderIds: [B]
    });
    expect(result.assignments.get(A)).toEqual(["x@g.us"]);
    expect(result.largestShare).toBe(1);
  });

  it("grupos exclusivos entram primeiro na conta do equilíbrio", () => {
    // A está sozinho em 4 grupos; os 4 compartilhados devem ir quase todos para B.
    const own = ["a1", "a2", "a3", "a4"].map((jid) => ({ whatsapp_sender_id: A, group_jid: `${jid}@g.us` }));
    const shared = ["s1", "s2", "s3", "s4"].flatMap((jid) => [A, B].map((sender) => ({ whatsapp_sender_id: sender, group_jid: `${jid}@g.us` })));
    const jids = [...own, ...shared].map((row) => row.group_jid).filter((jid, index, all) => all.indexOf(jid) === index);
    const result = splitGroupsAcrossSenders({ groups: membershipByGroup([...own, ...shared], jids), primarySenderId: A, availableSenderIds: [B] });
    expect(result.shares).toEqual([{ senderId: A, groups: 4 }, { senderId: B, groups: 4 }]);
  });
});

describe("alerta de fila atrasada", () => {
  it("sem atraso não mostra nada", () => {
    expect(describeLateQueue(0, 0)).toBeNull();
  });
  it("caso real: 1.065 envios, o mais antigo 6 horas atrasado", () => {
    const message = describeLateQueue(1065, 360)!;
    expect(message.title).toBe("Fila atrasada");
    expect(message.lines[0]).toBe("1.065 envios estão esperando há mais de 30 minutos.");
    expect(message.lines[1]).toBe("O mais antigo está 6 horas atrasado.");
    for (const line of message.lines) expect(line).not.toMatch(/[—–]| - /);
  });
});

describe("migration da divisão no Piloto", () => {
  const root = new URL("../../supabase/migrations/", import.meta.url);
  const migration = readFileSync(new URL("20261106120000_split_pilot_groups_across_senders.sql", root), "utf8");
  const previous = readFileSync(new URL("20261005200000_pilot_send_immediately.sql", root), "utf8");

  it("é a versão anterior inteira, só com o bloco novo acrescentado", () => {
    const start = previous.indexOf("CREATE OR REPLACE FUNCTION public.create_pilot_offer_schedule_locked");
    const end = previous.indexOf("$function$;", start) + "$function$;".length;
    const original = previous.slice(start, end).split(/\r?\n/);
    const replaced = migration.slice(migration.indexOf("CREATE OR REPLACE FUNCTION public.create_pilot_offer_schedule_locked")).split(/\r?\n/);
    let cursor = 0;
    for (const line of original) {
      const found = replaced.indexOf(line, cursor);
      expect(found, `linha da versão anterior sumiu: ${line}`).toBeGreaterThanOrEqual(cursor);
      cursor = found + 1;
    }
  });

  it("divisão é opt-in, idempotente e só usa número que está no grupo", () => {
    expect(migration).toContain("add column if not exists split_across_senders boolean not null default false");
    expect(migration).toContain("if coalesce(v_automation.split_across_senders, false) then");
    expect(migration).toContain("sender_group.group_jid = routed.whatsapp_group_id");
    expect(migration).toContain("whatsapp_sender_pauses");
    expect(migration).not.toMatch(/grant execute on function public\.create_pilot_offer_schedule_locked/i);
  });
});
