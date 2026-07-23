import { describe, expect, it, vi } from "vitest";
import { discoverParticipatingGroups } from "../groups/discovery.js";

describe("discoverParticipatingGroups", () => {
  it("junta grupos quando o WhatsApp retorna listas parciais", async () => {
    const groupFetchAllParticipating = vi
      .fn()
      .mockResolvedValueOnce({ "1@g.us": { id: "1@g.us", subject: "Grupo 1" } })
      .mockResolvedValueOnce({ "2@g.us": { id: "2@g.us", subject: "Grupo 2" } });

    const groups = await discoverParticipatingGroups({ groupFetchAllParticipating }, 2, 0);

    expect(groups.map((group) => group.id)).toEqual(["1@g.us", "2@g.us"]);
  });

  it("mantem a primeira lista quando uma nova consulta falha", async () => {
    const groupFetchAllParticipating = vi
      .fn()
      .mockResolvedValueOnce({ "1@g.us": { id: "1@g.us", subject: "Grupo 1" } })
      .mockRejectedValueOnce(new Error("falha temporaria"));

    const groups = await discoverParticipatingGroups({ groupFetchAllParticipating }, 2, 0);

    expect(groups).toHaveLength(1);
  });

  it("consulta individualmente os grupos que vieram sem nome", async () => {
    const groupFetchAllParticipating = vi.fn().mockResolvedValue({
      "1@g.us": { id: "1@g.us" }
    });
    const groupMetadata = vi.fn().mockResolvedValue({
      id: "1@g.us",
      subject: "MAPA DAS VENDAS ONLINE 01",
      participants: []
    });

    const groups = await discoverParticipatingGroups(
      { groupFetchAllParticipating, groupMetadata },
      1,
      0
    );

    expect(groupMetadata).toHaveBeenCalledWith("1@g.us");
    expect(groups[0]?.subject).toBe("MAPA DAS VENDAS ONLINE 01");
  });
});
