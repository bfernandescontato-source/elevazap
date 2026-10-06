import { NextRequest, NextResponse } from "next/server";
import { requireAccountContext } from "@/lib/security";
import { supabaseAdmin } from "@/lib/supabase";
import { isExtensaoVitrineEnabled } from "@/modules/affiliate-catalog/server/catalog-agenda-service";
import { extensionCorsHeaders, requireMercadoLivreExtension, safeBearer } from "@/modules/offer-autopilot/server/mercado-livre-extension";

export function OPTIONS() { return new NextResponse(null, { status: 204, headers: extensionCorsHeaders }); }

// Slug da loja Magazine Você da conta (para a extensão coletar os produtos da Magalu).
async function magaluStore(accountId: string) {
  const { data } = await supabaseAdmin().from("affiliate_integrations").select("affiliate_tag,status").eq("account_id", accountId).eq("provider", "magalu").maybeSingle();
  return data?.status === "connected" && data.affiliate_tag ? String(data.affiliate_tag) : null;
}

// A extensão pergunta com o token dela; a página /catalogo/extensao pergunta com a sessão.
export async function GET(request: NextRequest) {
  if (safeBearer(request)) {
    const integration = await requireMercadoLivreExtension(request);
    if (!integration) return NextResponse.json({ error: "Extensão não autorizada." }, { status: 401, headers: extensionCorsHeaders });
    const liberada = await isExtensaoVitrineEnabled(integration.account_id);
    return NextResponse.json({ liberada, magaluStore: liberada ? await magaluStore(integration.account_id) : null }, { headers: extensionCorsHeaders });
  }
  const context = await requireAccountContext(); if (context.error) return context.error;
  return NextResponse.json({ liberada: await isExtensaoVitrineEnabled(context.accountId) }, { headers: { "cache-control": "no-store" } });
}
