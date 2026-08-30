import { describe, expect, it } from "vitest";
import { parseMetaThroughputMps, urgentBroadcastConcurrency } from "../modules/official-whatsapp/server/throughput";

describe("throughput da API Oficial", () => {
  it("interpreta o nível STANDARD da Graph API como 80 mensagens por segundo", () => {
    expect(parseMetaThroughputMps({ level: "STANDARD" })).toBe(80);
  });

  it("mantém compatibilidade com respostas numéricas", () => {
    expect(parseMetaThroughputMps(120)).toBe(120);
    expect(parseMetaThroughputMps({ messages_per_second: "80" })).toBe(80);
  });

  it("usa 60 simultâneos no nível STANDARD e fallback seguro sem informação", () => {
    expect(urgentBroadcastConcurrency(80)).toBe(60);
    expect(urgentBroadcastConcurrency(1_000)).toBe(60);
    expect(urgentBroadcastConcurrency(null)).toBe(20);
  });
});
