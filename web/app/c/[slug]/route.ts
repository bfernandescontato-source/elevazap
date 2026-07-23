import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { syncCampaignGroups } from "@/lib/campaign-group-sync";
import { supabaseAdmin } from "@/lib/supabase";

function messagePage(message: string, status = 200) {
  const safeMessage = message.replace(/[<>&"']/g, (character) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;" })[character] || character);
  return new NextResponse(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Disparei</title><style>body{margin:0;background:#f7f7f6;color:#171717;font-family:Arial,sans-serif;display:grid;min-height:100vh;place-items:center;padding:24px;box-sizing:border-box}.box{max-width:520px;text-align:center;background:#fff;border:1px solid #e5e5e5;padding:40px 28px;border-radius:8px}h1{font-size:24px;margin:0 0 12px}p{color:#666;line-height:1.6;margin:0}</style></head><body><main class="box"><h1>Grupos indisponíveis</h1><p>${safeMessage}</p></main></body></html>`, { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}

export async function GET(request: NextRequest, { params }: { params: { slug: string } }) {
  const sb = supabaseAdmin();
  const { data: campaign, error } = await sb.from("campanhas").select("id,status,link_ativo").eq("public_slug", params.slug).maybeSingle();
  if (error || !campaign) return messagePage("Este link não existe ou não está mais disponível.", 404);

  if (campaign.status === "ativa" && campaign.link_ativo) {
    await syncCampaignGroups(campaign.id).catch(() => undefined);
  }

  const utm = Object.fromEntries(
    ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"]
      .map((key) => [key, request.nextUrl.searchParams.get(key)])
      .filter(([, value]) => Boolean(value))
  );
  const sessionId = request.cookies.get("disparei_session")?.value || randomUUID();
  const { data, error: redirectError } = await sb.rpc("resolve_campaign_redirect", {
    p_slug: params.slug,
    p_utm: utm,
    p_user_agent: request.headers.get("user-agent")?.slice(0, 500) || null,
    p_anonymous_session_id: sessionId
  });
  if (redirectError) return messagePage("Não foi possível processar este acesso agora. Tente novamente em instantes.", 503);

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
