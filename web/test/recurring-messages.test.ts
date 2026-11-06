import { describe, expect, it } from "vitest";
import {
  GROUP_LINK_PLACEHOLDER, INVITE_TEMPLATE, addLocalDays, isoWeekday, localDate, nextOccurrence, normalizeTimes,
  normalizeWeekdays, occurrenceKey, previewWithGroupLink, textWithoutPlaceholder, upcomingOccurrences
} from "../modules/recurring-messages/schedule";
import { recurringMessageInputSchema } from "../modules/recurring-messages/schemas";

const id = "11111111-1111-4111-8111-111111111111";
const everyDay = [1, 2, 3, 4, 5, 6, 7];

describe("mensagens automáticas: ocorrências", () => {
  it("cria hoje e amanhã nos horários de São Paulo", () => {
    // 06/11/2026 é sexta. 08:00 em São Paulo = 11:00 UTC.
    const now = new Date("2026-11-06T11:00:00Z");
    const list = upcomingOccurrences(id, { times: ["09:00", "21:30"], weekdays: everyDay }, now);
    expect(list.map((item) => `${item.localDate} ${item.localTime}`)).toEqual([
      "2026-11-06 09:00", "2026-11-06 21:30", "2026-11-07 09:00", "2026-11-07 21:30"
    ]);
    expect(list[0].scheduledAt).toBe("2026-11-06T12:00:00.000Z");
    expect(list[1].scheduledAt).toBe("2026-11-07T00:30:00.000Z");
  });

  it("pula horário que já passou ou falta menos de 1 minuto", () => {
    const now = new Date("2026-11-06T11:59:30Z"); // 08:59:30 local
    const list = upcomingOccurrences(id, { times: ["08:00", "09:00", "10:00"], weekdays: everyDay }, now);
    expect(list[0]).toMatchObject({ localDate: "2026-11-06", localTime: "10:00" });
  });

  it("usa o dia local perto da meia-noite UTC", () => {
    // 01:30 UTC de sábado ainda é 22:30 de sexta em São Paulo.
    const now = new Date("2026-11-07T01:30:00Z");
    expect(localDate(now)).toBe("2026-11-06");
    const list = upcomingOccurrences(id, { times: ["23:00"], weekdays: everyDay }, now);
    expect(list.map((item) => item.localDate)).toEqual(["2026-11-06", "2026-11-07"]);
    expect(list[0].scheduledAt).toBe("2026-11-07T02:00:00.000Z");
  });

  it("respeita os dias da semana (ISO, 1 = segunda)", () => {
    expect(isoWeekday("2026-11-06")).toBe(5);
    expect(isoWeekday("2026-11-08")).toBe(7);
    expect(isoWeekday("2026-11-09")).toBe(1);
    const friday = new Date("2026-11-06T11:00:00Z");
    expect(upcomingOccurrences(id, { times: ["12:00"], weekdays: [1, 2, 3, 4, 5] }, friday).map((item) => item.localDate)).toEqual(["2026-11-06"]);
    expect(upcomingOccurrences(id, { times: ["12:00"], weekdays: [6] }, friday).map((item) => item.localDate)).toEqual(["2026-11-07"]);
    expect(nextOccurrence(id, { times: ["12:00"], weekdays: [1] }, friday)?.localDate).toBe("2026-11-09");
  });

  it("deslocamento fixo de -03:00 o ano todo (sem horário de verão)", () => {
    for (const day of ["2026-01-15", "2026-07-15", "2026-10-20", "2026-12-31"]) {
      const now = new Date(`${day}T03:00:00Z`);
      const [first] = upcomingOccurrences(id, { times: ["12:00"], weekdays: everyDay }, now);
      expect(first.scheduledAt).toBe(`${day}T15:00:00.000Z`);
    }
  });

  it("vira mês e ano", () => {
    expect(addLocalDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addLocalDays("2028-02-28", 1)).toBe("2028-02-29");
  });

  it("mensagem desligada não tem ocorrência", () => {
    expect(upcomingOccurrences(id, { times: ["12:00"], weekdays: everyDay, active: false }, new Date("2026-11-06T11:00:00Z"))).toEqual([]);
  });

  it("chave de idempotência por mensagem, data e horário", () => {
    const first = upcomingOccurrences(id, { times: ["09:00", "09:00", "09:00 "], weekdays: everyDay }, new Date("2026-11-06T11:00:00Z"));
    const again = upcomingOccurrences(id, { times: ["09:00"], weekdays: everyDay }, new Date("2026-11-06T11:05:00Z"));
    expect(first.map((item) => item.key)).toEqual(again.map((item) => item.key));
    expect(new Set(first.map((item) => item.key)).size).toBe(first.length);
    expect(occurrenceKey(id, "2026-11-06", "09:00:00")).toBe(`${id}:2026-11-06:09:00`);
  });

  it("normaliza horários e dias", () => {
    expect(normalizeTimes(["21:00", "08:30", "08:30", "25:00", "x"])).toEqual(["08:30", "21:00"]);
    expect(normalizeWeekdays([7, 1, 1, 0, 8])).toEqual([1, 7]);
  });
});

describe("mensagens automáticas: link do grupo e validação", () => {
  it("prévia troca a variável pelo link", () => {
    expect(previewWithGroupLink(`Entre: ${GROUP_LINK_PLACEHOLDER}`, "https://chat.whatsapp.com/abc")).toBe("Entre: https://chat.whatsapp.com/abc");
    expect(INVITE_TEMPLATE).toContain(GROUP_LINK_PLACEHOLDER);
    expect(INVITE_TEMPLATE).not.toMatch(/ [–—-] /);
    expect(textWithoutPlaceholder(` ${GROUP_LINK_PLACEHOLDER} `)).toBe("");
  });

  const valid = {
    nome: "Regras", tipo: "texto", texto: "Leia as regras.", whatsapp_sender_id: id,
    group_jids: ["120363000000000001@g.us"], horarios: ["21:00", "09:00"], dias_semana: [5, 1]
  };

  it("aceita e normaliza a mensagem", () => {
    const parsed = recurringMessageInputSchema.parse(valid);
    expect(parsed.horarios).toEqual(["09:00", "21:00"]);
    expect(parsed.dias_semana).toEqual([1, 5]);
    expect(parsed.ativo).toBe(true);
  });

  it("recusa mais de 5 horários, texto só com o link, imagem sem arquivo e grupo inválido", () => {
    expect(recurringMessageInputSchema.safeParse({ ...valid, horarios: ["01:00", "02:00", "03:00", "04:00", "05:00", "06:00"] }).success).toBe(false);
    expect(recurringMessageInputSchema.safeParse({ ...valid, texto: GROUP_LINK_PLACEHOLDER }).success).toBe(false);
    expect(recurringMessageInputSchema.safeParse({ ...valid, tipo: "imagem", media: null }).success).toBe(false);
    expect(recurringMessageInputSchema.safeParse({ ...valid, group_jids: ["nao-e-grupo"] }).success).toBe(false);
  });
});
