export type RoutingCampaign = {
  status: string;
  link_ativo: boolean;
  reuse_available_groups?: boolean;
  allow_stale_participant_count?: boolean;
  participant_data_max_age_seconds?: number;
  participant_data_stale_grace_seconds?: number;
  stale_participant_safety_margin?: number;
};

export type RoutingGroup = {
  group_jid: string;
  position?: number;
  manual_status?: string;
  invite_url?: string | null;
  participant_count?: number | null;
  participants_synced_at?: string | null;
  participant_limit?: number | null;
  safety_margin?: number;
  capacity_reached_at?: string | null;
};

// Espelha o resolve_campaign_redirect de cinco argumentos, sem registrar um acesso.
export function campaignGroupUnavailableReason(group: RoutingGroup, campaign: RoutingCampaign, now = Date.now()): string | null {
  if (group.manual_status === "cheio") return "Marcado manualmente como cheio";
  if (group.manual_status !== "disponivel") return "Pausado";
  if (!group.invite_url?.startsWith("https://chat.whatsapp.com/")) return "Link de convite inválido";
  if (group.participant_count == null) return "Quantidade de participantes indisponível";
  const syncedAt = group.participants_synced_at ? Date.parse(group.participants_synced_at) : Number.NaN;
  const maxAge = (campaign.participant_data_max_age_seconds ?? 900) * 1000;
  const grace = campaign.allow_stale_participant_count ? (campaign.participant_data_stale_grace_seconds ?? 3600) * 1000 : 0;
  if (!Number.isFinite(syncedAt) || syncedAt < now - maxAge - grace) return "Participantes desatualizados";
  if (!campaign.reuse_available_groups && group.capacity_reached_at) return "Limite atingido anteriormente";
  const staleMargin = syncedAt < now - maxAge ? campaign.stale_participant_safety_margin ?? 10 : 0;
  if (group.participant_limit != null && group.participant_count >= Math.max(0, group.participant_limit - (group.safety_margin ?? 0) - staleMargin)) return "Limite de participantes atingido";
  return null;
}

// A rota pública usa este modo de contingência quando o RPC falha ou não tem destino.
export function campaignFallbackGroupEligible(group: RoutingGroup, campaign: Pick<RoutingCampaign, "reuse_available_groups">): boolean {
  if (group.manual_status && group.manual_status !== "disponivel") return false;
  if (!group.invite_url?.startsWith("https://chat.whatsapp.com/")) return false;
  if (group.participant_count == null || !group.participants_synced_at) return true;
  if (!campaign.reuse_available_groups && group.capacity_reached_at) return false;
  return group.participant_limit == null || group.participant_count < Math.max(0, group.participant_limit - (group.safety_margin ?? 0));
}

export function campaignRoutingGroups<T extends RoutingGroup>(groups: T[], campaign: RoutingCampaign, now = Date.now()): T[] {
  if (campaign.status !== "ativa" || !campaign.link_ativo) return [];
  const ordered = [...groups].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  const primary = ordered.filter((group) => !campaignGroupUnavailableReason(group, campaign, now));
  return primary.length ? primary : ordered.filter((group) => campaignFallbackGroupEligible(group, campaign));
}
