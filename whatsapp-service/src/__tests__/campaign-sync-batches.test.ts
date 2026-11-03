import { describe, expect, it } from "vitest";
import { campaignSyncBatches } from "../groups/campaign-sync-batches.js";
const senders = [{ id: "suporte1", account_id: "ana", session_name: "sessao1" }, { id: "suporte2", account_id: "ana", session_name: "sessao2" }, { id: "outro", account_id: "outra-conta", session_name: "sessao3" }];
describe("sincronização pelo número responsável da campanha", () => {
  it("usa SUPORTE 02 em vez do primeiro número da conta", () => {
    const batches = campaignSyncBatches([{ id: "faceclub", account_id: "ana", whatsapp_sender_id: "suporte2", campanha_grupos: [{ group_jid: "grupo2" }] }], senders);
    expect([...batches.values()][0]).toMatchObject({ senderId: "suporte2", sessionName: "sessao2", campaignIds: ["faceclub"] });
  });
  it("separa campanhas com números responsáveis diferentes", () => {
    const batches = campaignSyncBatches([{ id: "a", account_id: "ana", whatsapp_sender_id: "suporte1" }, { id: "b", account_id: "ana", whatsapp_sender_id: "suporte2" }], senders);
    expect(batches.size).toBe(2);
  });
  it("preserva o fallback de campanhas antigas sem número definido", () => {
    expect([...campaignSyncBatches([{ id: "a", account_id: "ana" }], senders).values()][0].senderId).toBe("suporte1");
  });
  it("não usa um número de outra conta nem troca um responsável ausente", () => {
    for (const id of ["outro", "inexistente"]) expect([...campaignSyncBatches([{ id: "a", account_id: "ana", whatsapp_sender_id: id }], senders).values()][0].sessionName).toBeNull();
  });
});
