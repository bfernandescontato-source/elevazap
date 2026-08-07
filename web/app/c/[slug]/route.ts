import { createHmac, randomUUID } from "crypto";
import { after, NextRequest, NextResponse } from "next/server";
import { env } from "@/lib/env";
import { supabaseAdmin } from "@/lib/supabase";

function messagePage(message: string, status = 200) {
  const safeMessage = message.replace(/[<>&"']/g, (character) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;" })[character] || character);
  return new NextResponse(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Disparei</title><style>body{margin:0;background:#f7f7f6;color:#171717;font-family:Arial,sans-serif;display:grid;min-height:100vh;place-items:center;padding:24px;box-sizing:border-box}.box{max-width:520px;text-align:center;background:#fff;border:1px solid #e5e5e5;padding:40px 28px;border-radius:8px}h1{font-size:24px;margin:0 0 12px}p{color:#666;line-height:1.6;margin:0}</style></head><body><main class="box"><h1>Grupos indisponíveis</h1><p>${safeMessage}</p></main></body></html>`, { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}

function isMissingRedirectRpc(error: any) {
  return Boolean(error && (
    error.code === "PGRST202" ||
    error.code === "42883" ||
    /could not find the function.*resolve_campaign_redirect|function.*resolve_campaign_redirect.*does not exist/i.test(error.message || "")
  ));
}

function isMissingColumnError(error: any) {
  return Boolean(error && (error.code === "PGRST204" || error.code === "42703" || /column .* does not exist|could not find the .* column/i.test(error.message || "")));
}

async function resolveRedirectFallback(sb: any, slug: string) {
  let { data: campaign, error: campaignError } = await sb.from("campanhas")
    .select("id,status,link_ativo,fallback_type,fallback_url,allow_stale_participant_count,participant_data_max_age_seconds,participant_data_stale_grace_seconds,stale_participant_safety_margin,reuse_available_groups")
    .eq("public_slug", slug)
    .maybeSingle();
  if (campaignError && isMissingColumnError(campaignError)) {
    const legacy = await sb.from("campanhas").select("id,status,link_ativo,fallback_type,fallback_url").eq("public_slug", slug).maybeSingle();
    campaign = legacy.data;
    campaignError = legacy.error;
  }
  if (campaignError) throw campaignError;
  if (!campaign) return { ok: false, not_found: true };

  const fallbackUrl = campaign.fallback_type === "url" ? campaign.fallback_url : null;
  if (campaign.status !== "ativa" || !campaign.link_ativo) return { ok: false, fallback_url: fallbackUrl };

  let { data: links, error: linksError } = await sb.from("campanha_grupos")
    .select("group_jid,position,manual_status,participant_count,participants_synced_at,participant_limit,safety_margin,capacity_reached_at,invite_url")
    .eq("campanha_id", campaign.id);
  if (linksError && isMissingColumnError(linksError)) {
    const legacy = await sb.from("campanha_grupos").select("group_jid,invite_url").eq("campanha_id", campaign.id);
    links = legacy.data;
    linksError = legacy.error;
  }
  if (linksError) throw linksError;

  const selected = (links || [])
    .filter((group: any) => {
      if (group.manual_status && group.manual_status !== "disponivel") return false;
      if (!group.invite_url || !/^https:\/\/chat\.whatsapp\.com\//.test(group.invite_url)) return false;
      if (group.participant_count == null || !group.participants_synced_at) return Boolean(group.invite_url);
      if (!campaign.reuse_available_groups && group.capacity_reached_at) return false;
      if (group.participant_limit != null && Number(group.participant_count) >= Math.max(0, Number(group.participant_limit) - Number(group.safety_margin || 0))) return false;
      return true;
    })
    .sort((a: any, b: any) => Number(a.position || 0) - Number(b.position || 0))[0];

  if (!selected) {
    after(async () => {
      await sb.from("campanhas").update({ updated_at: new Date().toISOString() }).eq("id", campaign.id).then(() => undefined).catch(() => undefined);
    });
    return { ok: false, fallback_url: fallbackUrl, reason: "nenhum_grupo_confiavel" };
  }

  // O visitante não deve esperar métricas e contadores para chegar ao grupo.
  after(async () => {
    const nowIso = new Date().toISOString();
    await Promise.all([
      sb.from("campanha_grupos").update({ updated_at: nowIso }).eq("campanha_id", campaign.id).eq("group_jid", selected.group_jid),
      sb.from("campanhas").update({ updated_at: nowIso }).eq("id", campaign.id)
    ]).catch(() => undefined);
  });
  return { ok: true, destination_url: selected.invite_url, campaign_id: campaign.id, group_jid: selected.group_jid };
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const sb = supabaseAdmin();
  const { data: tenantCampaign } = await sb.from("campanhas").select("account_id,accounts!inner(status)").eq("public_slug", slug).maybeSingle();
  const tenantAccount = Array.isArray(tenantCampaign?.accounts) ? tenantCampaign.accounts[0] : tenantCampaign?.accounts;
  if (!tenantCampaign || tenantAccount?.status !== "active") return messagePage("Este link não existe ou não está mais disponível.", 404);
  const utm = Object.fromEntries(
    ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"]
      .map((key) => [key, request.nextUrl.searchParams.get(key)])
      .filter(([, value]) => Boolean(value))
  );
  const sessionId = request.cookies.get("disparei_session")?.value || randomUUID();
  const proxyIp = request.headers.get("x-vercel-forwarded-for")?.split(",")[0]?.trim()
    || request.headers.get("x-real-ip")?.trim()
    || "unknown";
  const rateLimitKey = createHmac("sha256", env().INTERNAL_API_KEY)
    .update(`${proxyIp}:${sessionId}`)
    .digest("hex");
  let { data, error: redirectError } = await sb.rpc("resolve_campaign_redirect", {
    p_slug: slug,
    p_utm: utm,
    p_user_agent: request.headers.get("user-agent")?.slice(0, 500) || null,
    p_anonymous_session_id: sessionId,
    p_rate_limit_key: rateLimitKey
  });
  if (redirectError && isMissingRedirectRpc(redirectError)) {
    try {
      data = await resolveRedirectFallback(sb, slug);
      redirectError = null;
    } catch (fallbackError) {
      console.error("campaign redirect fallback failed", fallbackError);
    }
  }
  if (!redirectError && !data?.destination_url && !data?.not_found && !data?.rate_limited) {
    try {
      const fallback = await resolveRedirectFallback(sb, slug);
      if (fallback?.destination_url || fallback?.fallback_url) data = fallback;
    } catch (fallbackError) {
      console.error("campaign redirect availability fallback failed", fallbackError);
    }
  }
  if (redirectError) return messagePage("Não foi possível processar este acesso agora. Tente novamente em instantes.", 503);
  if (data?.not_found) return messagePage("Este link não existe ou não está mais disponível.", 404);
  if (data?.rate_limited) return messagePage("Muitos acessos foram recebidos. Aguarde um minuto e tente novamente.", 429);

  const target = data?.destination_url || data?.fallback_url;
  if (target) {
    const response = NextResponse.redirect(target, 302);
    response.cookies.set("disparei_session", sessionId, { httpOnly: true, sameSite: "lax", maxAge: 60 * 60 * 24 * 30, secure: true });
    return response;
  }
  const response = messagePage("Os grupos desta campanha estão temporariamente indisponíveis. Aguarde a abertura de novas vagas.");
  response.cookies.set("disparei_session", sessionId, { httpOnly: true, sameSite: "lax", maxAge: 60 * 60 * 24 * 30, secure: true });
  return response;
}
