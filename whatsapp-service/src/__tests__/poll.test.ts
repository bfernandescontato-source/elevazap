import { describe, expect, it, vi } from "vitest";
import { generateWAMessageContent } from "@whiskeysockets/baileys";
import { buildBaileysMessage } from "../utils/media.js";

vi.mock("../supabase.js", () => ({ supabase: {} }));
vi.mock("../env.js", () => ({ env: { MEDIA_CACHE_MAX_BYTES: 1024, MEDIA_CACHE_TTL_MS: 1000 } }));

describe("envio nativo de enquetes", () => {
  const poll = { name: "Qual horário?", values: ["Manhã", "Noite"], selectableCount: 1 };

  it("gera enquete de escolha única sem exigir mídia ou converter em texto", async () => {
    const message = buildBaileysMessage({ tipo: "enquete", poll });
    const content = await generateWAMessageContent(message as any, {} as any);
    expect(content.pollCreationMessageV3).toMatchObject({
      name: poll.name, selectableOptionsCount: 1,
      options: [{ optionName: "Manhã" }, { optionName: "Noite" }]
    });
    expect(content.messageContextInfo?.messageSecret).toHaveLength(32);
    expect(content.conversation).toBeNull();
  });

  it("gera enquete com múltiplas respostas", async () => {
    const message = buildBaileysMessage({ tipo: "enquete", poll: { ...poll, selectableCount: 2 } });
    const content = await generateWAMessageContent(message as any, {} as any);
    expect(content.pollCreationMessage).toMatchObject({ name: poll.name, selectableOptionsCount: 2 });
  });

  it("impede envio de uma enquete inválida salva", () => {
    expect(() => buildBaileysMessage({ tipo: "enquete", poll: { ...poll, values: ["Sim", " sim "] } })).toThrow();
    expect(() => buildBaileysMessage({ tipo: "enquete" })).toThrow();
  });
});
