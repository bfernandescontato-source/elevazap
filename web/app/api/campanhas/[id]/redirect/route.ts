import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { guardAdminMutation, requireAccountContext } from "@/lib/security";
import { validateGroupJid } from "@/lib/phone";
import { supabaseAdmin } from "@/lib/supabase";

const campaignSettingsSchema = z.object({
  action: z.literal("campaign_settings"),
  status: z.enum(["ativa", "pausada", "encerrada"]).optional(),
  link_ativo: z.boolean().optional(),
  fallback_type: z.enum(["padrao", "url"]).optional(),
  fallback_url: z.string().url().nullable().optional(),
  reuse_available_groups: z.boolean().optional(),
  allow_stale_participant_count: z.boolean().optional()
});

const groupSettingsSchema = z.object({
  action: z.literal("group_settings"),
  group_jid: z.string(),
  manual_status: z.enum(["disponivel", "cheio", "pausado"]).optional(),
  participant_limit: z.number().int().positive().nullable().optional(),
  safety_margin: z.number().int().min(0).max(10000).optional(),
  invite_url: z.string().url().nullable().optional()
});

const actionSchema = z.discriminatedUnion("action", [
  campaignSettingsSchema,
  groupSettingsSchema,
  z.object({ action: z.literal("reorder"), group_jids: z.array(z.string()).min(1) }),
  z.object({ action: z.literal("regenerate_slug") }),
  z.object({ action: z.literal("reset_redirect_count"), group_jid: z.string() })
]);

function calculatedSituation(group: any, campaign: any, activeGroupJid?: string) {
  if (group.manual_status === "cheio") return "Marcado manualmente como cheio";
  if (group.manual_status === "pausado") return "Pausado";
  if (group.participants_sync_error && !campaign.allow_stale_participant_count) return "Falha na sincronização";
  if (group.participant_count == null) return "Quantidade de participantes indisponível";
  if (!group.invite_url || !/^https:\/\/chat\.whatsapp\.com\//.test(group.invite_url)) return "Link de convite inválido";
  if (group.participant_limit != null && group.participant_count >= Math.max(0, group.participant_limit - group.safety_margin)) return "Limite de participantes atingido";
  if (!campaign.reuse_available_groups && group.capacity_reached_at) return "Limite atingido anteriormente";
  return group.group_jid === activeGroupJid ? "Recebendo leads" : "Aguardando na fila";
}

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const context = await requireAccountContext();
  if (context.error) return context.error;
  const { id } = await params;
  const sb = supabaseAdmin();
  const { data: campaign, error } = await sb.from("campanhas")
    .select("id,nome,public_slug,status,link_ativo,fallback_type,fallback_url,reuse_available_groups,allow_stale_participant_count,total_accesses,total_redirects,whatsapp_sender_id,created_at,updated_at,whatsapp_senders(id,label,session_name),campanha_grupos(*,grupos(group_jid,nome,qtd_membros,foto_url))")
    .eq("id", id).eq("account_id", context.accountId).maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!campaign) return NextResponse.json({ error: "Campanha não encontrada." }, { status: 404 });

  const groups = (campaign.campanha_grupos || []).map((item: any) => ({ ...item, ...(item.grupos || {}) })).sort((a: any, b: any) => a.position - b.position);
  const eligible = campaign.status === "ativa" && campaign.link_ativo ? groups.filter((group: any) => group.manual_status === "disponivel"
    && group.participant_count != null
    && /^https:\/\/chat\.whatsapp\.com\//.test(group.invite_url || "")
    && (group.participant_limit == null || group.participant_count < Math.max(0, group.participant_limit - group.safety_margin))
    && (campaign.reuse_available_groups || !group.capacity_reached_at)
    && (campaign.allow_stale_participant_count || !group.participants_sync_error)) : [];
  const activeGroupJid = eligible[0]?.group_jid;

  const [{ data: events }, { data: metricBreakdown }] = await Promise.all([
    sb.from("campaign_redirect_events").select("*").eq("campaign_id", campaign.id).eq("account_id", context.accountId).order("created_at", { ascending: false }).limit(300),
    sb.rpc("get_campaign_redirect_metrics", { p_campaign_id: campaign.id })
  ]);
  const responseGroups = groups.map((group: any) => ({ ...group, situacao: calculatedSituation(group, campaign, activeGroupJid) }));
  const sender = Array.isArray(campaign.whatsapp_senders) ? campaign.whatsapp_senders[0] || null : campaign.whatsapp_senders;
  return NextResponse.json({
    campaign: { ...campaign, whatsapp_senders: sender, campanha_grupos: undefined, groups: responseGroups, active_group_jid: activeGroupJid || null, next_group_jid: eligible[1]?.group_jid || null },
    events: events || [],
    metrics: {
      accesses: Number(campaign.total_accesses || 0),
      redirects: Number(campaign.total_redirects || 0),
      failures: Number(metricBreakdown?.failures || 0),
      daily: metricBreakdown?.daily || [],
      sources: metricBreakdown?.sources || []
    }
  });
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await guardAdminMutation(request, "campanhas_ip");
  if (guard) return guard;
  const context = await requireAccountContext();
  if (context.error) return context.error;
  const { id } = await params;
  const parsed = actionSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Configuração inválida." }, { status: 400 });
  const body = parsed.data;
  const sb = supabaseAdmin();
  const now = new Date().toISOString();

  if (body.action === "campaign_settings") {
    if (body.fallback_type === "url" && !body.fallback_url) return NextResponse.json({ error: "Informe uma URL de contingência válida." }, { status: 400 });
    const values = Object.fromEntries(Object.entries(body).filter(([key, value]) => key !== "action" && value !== undefined));
    const { error } = await sb.from("campanhas").update({ ...values, updated_at: now }).eq("id", id).eq("account_id", context.accountId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (body.action === "group_settings") {
    if (!validateGroupJid(body.group_jid)) return NextResponse.json({ error: "Grupo inválido." }, { status: 400 });
    if (body.invite_url && !/^https:\/\/chat\.whatsapp\.com\//.test(body.invite_url)) return NextResponse.json({ error: "Use um link de convite válido do WhatsApp." }, { status: 400 });
    const values: Record<string, unknown> = Object.fromEntries(Object.entries(body).filter(([key, value]) => !["action", "group_jid"].includes(key) && value !== undefined));
    if (body.participant_limit !== undefined || body.safety_margin !== undefined || body.manual_status === "disponivel") values.capacity_reached_at = null;
    const { error } = await sb.from("campanha_grupos").update({ ...values, updated_at: now }).eq("campanha_id", id).eq("account_id", context.accountId).eq("group_jid", body.group_jid);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (body.action === "reorder") {
    if (body.group_jids.some((jid) => !validateGroupJid(jid))) return NextResponse.json({ error: "Ordem inválida." }, { status: 400 });
    const { data: current } = await sb.from("campanha_grupos").select("group_jid").eq("campanha_id", id).eq("account_id", context.accountId);
    const currentJids = new Set((current || []).map((item) => item.group_jid));
    if (body.group_jids.length !== currentJids.size || body.group_jids.some((jid) => !currentJids.has(jid))) return NextResponse.json({ error: "A ordem precisa conter todos os grupos da campanha." }, { status: 400 });
    for (let index = 0; index < body.group_jids.length; index += 1) {
      const { error } = await sb.from("campanha_grupos").update({ position: index + 1, updated_at: now }).eq("campanha_id", id).eq("account_id", context.accountId).eq("group_jid", body.group_jids[index]);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  if (body.action === "regenerate_slug") {
    const publicSlug = randomUUID().replace(/-/g, "");
    const { error } = await sb.from("campanhas").update({ public_slug: publicSlug, updated_at: now }).eq("id", id).eq("account_id", context.accountId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (body.action === "reset_redirect_count") {
    const { error } = await sb.from("campanha_grupos").update({ redirection_count: 0, updated_at: now }).eq("campanha_id", id).eq("account_id", context.accountId).eq("group_jid", body.group_jid);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
