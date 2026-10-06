import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { extensionCorsHeaders, requireMercadoLivreExtension } from "@/modules/offer-autopilot/server/mercado-livre-extension";
import { isExtensaoVitrineEnabled } from "@/modules/affiliate-catalog/server/catalog-agenda-service";
import { syncMercadoLivreHub } from "@/modules/affiliate-catalog/server/mercado-livre-hub-service";

export const runtime = "nodejs";
export function OPTIONS() { return new NextResponse(null, { status: 204, headers: extensionCorsHeaders }); }

// A extensão dispara isto na coleta diária; o servidor puxa a central de afiliados do ML
// (com a sessão guardada) e enche o catálogo com a comissão. Não abre o ML no navegador.
export async function POST(request: NextRequest) {
  const integration = await requireMercadoLivreExtension(request);
  if (!integration) return NextResponse.json({ error: "Extensão não autorizada." }, { status: 401, headers: extensionCorsHeaders });
  if (!await isExtensaoVitrineEnabled(integration.account_id)) return NextResponse.json({ error: "Coleta não liberada." }, { status: 403, headers: extensionCorsHeaders });
  try {
    return NextResponse.json(await syncMercadoLivreHub(supabaseAdmin(), integration.account_id), { headers: extensionCorsHeaders });
  } catch (error) {
    const code = error instanceof Error ? error.message : "MERCADO_LIVRE_HUB_UNAVAILABLE";
    console.error({ event: "mercado_livre_hub_sync_failed", account_id: integration.account_id, code });
    return NextResponse.json({ error: code === "MERCADO_LIVRE_SESSION_MISSING" ? "Reconecte a extensão ao Mercado Livre." : "Não foi possível puxar a central de afiliados do Mercado Livre.", code }, { status: code === "MERCADO_LIVRE_SESSION_MISSING" ? 409 : 503, headers: extensionCorsHeaders });
  }
}
