import { describe, expect, it } from "vitest";
import { campaignGroupUnavailableReason, campaignRoutingGroups, type RoutingGroup } from "../lib/campaign-routing";

const now = Date.parse("2026-11-03T17:27:00Z");
const campaign = { status: "ativa", link_ativo: true, allow_stale_participant_count: true, reuse_available_groups: false, participant_data_max_age_seconds: 900, participant_data_stale_grace_seconds: 3600, stale_participant_safety_margin: 10 };
const group = (id: string, minutesAgo: number, position: number): RoutingGroup => ({ group_jid: id, position, manual_status: "disponivel", participant_count: 803, participants_synced_at: new Date(now - minutesAgo * 60000).toISOString(), invite_url: "https://chat.whatsapp.com/valid" });

describe("destino mostrado no painel da campanha", () => {
  it("pula o grupo 2 vencido e mostra o grupo 4 que o link realmente escolhe", () => {
    const groups = [group("2", 165, 1), group("4", 52, 2), group("3", 27, 4)];
    expect(campaignRoutingGroups(groups, campaign, now).map(g => g.group_jid)).toEqual(["4", "3"]);
    expect(campaignGroupUnavailableReason(groups[0], campaign, now)).toBe("Participantes desatualizados");
  });
  it("aceita o limite de 75 minutos e rejeita dados mais antigos", () => {
    expect(campaignGroupUnavailableReason(group("a", 75, 1), campaign, now)).toBeNull();
    expect(campaignGroupUnavailableReason(group("a", 75.001, 1), campaign, now)).toBe("Participantes desatualizados");
  });
  it("aplica a margem extra a contagens antigas antes de escolher o próximo grupo", () => {
    const full = { ...group("a", 20, 1), participant_count: 995, participant_limit: 1000 };
    expect(campaignRoutingGroups([full, group("b", 10, 2)], campaign, now)[0].group_jid).toBe("b");
  });
  it("mostra o destino de contingência se nenhum grupo tiver dados recentes", () => {
    expect(campaignRoutingGroups([group("a", 200, 1), group("b", 180, 2)], campaign, now)[0].group_jid).toBe("a");
  });
  it("não mostra grupo recebendo leads quando a campanha ou o link está pausado", () => {
    expect(campaignRoutingGroups([group("a", 10, 1)], { ...campaign, status: "pausada" }, now)).toEqual([]);
    expect(campaignRoutingGroups([group("a", 10, 1)], { ...campaign, link_ativo: false }, now)).toEqual([]);
  });
  it("retorna ao primeiro grupo quando os participantes são atualizados", () => {
    expect(campaignRoutingGroups([group("2", 0, 1), group("4", 52, 2)], campaign, now)[0].group_jid).toBe("2");
  });
});
