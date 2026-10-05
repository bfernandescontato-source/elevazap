import { NextRequest, NextResponse } from "next/server";
import { requireAccountContext } from "@/lib/security";
import { isExtensaoVitrineEnabled } from "@/modules/affiliate-catalog/server/catalog-agenda-service";
import { extensionCorsHeaders, requireMercadoLivreExtension, safeBearer } from "@/modules/offer-autopilot/server/mercado-livre-extension";

export function OPTIONS() { return new NextResponse(null, { status: 204, headers: extensionCorsHeaders }); }

// A extensão pergunta com o token dela; a página /catalogo/extensao pergunta com a sessão.
export async function GET(request: NextRequest) {
  if (safeBearer(request)) {
    const integration = await requireMercadoLivreExtension(request);
    if (!integration) return NextResponse.json({ error: "Extensão não autorizada." }, { status: 401, headers: extensionCorsHeaders });
    return NextResponse.json({ liberada: await isExtensaoVitrineEnabled(integration.account_id) }, { headers: extensionCorsHeaders });
  }
  const context = await requireAccountContext(); if (context.error) return context.error;
  return NextResponse.json({ liberada: await isExtensaoVitrineEnabled(context.accountId) }, { headers: { "cache-control": "no-store" } });
}
