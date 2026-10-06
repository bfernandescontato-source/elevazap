import { NextRequest, NextResponse } from "next/server";
import { extensionCorsHeaders, requireMercadoLivreExtension } from "@/modules/offer-autopilot/server/mercado-livre-extension";
import { isExtensaoVitrineEnabled } from "@/modules/affiliate-catalog/server/catalog-agenda-service";
import { importShopeeCoupons } from "@/modules/affiliate-catalog/server/shopee-coupons-service";

export const runtime = "nodejs";
export function OPTIONS() { return new NextResponse(null, { status: 204, headers: extensionCorsHeaders }); }

export async function POST(request: NextRequest) {
  const integration = await requireMercadoLivreExtension(request);
  if (!integration) return NextResponse.json({ error: "Extensão não autorizada." }, { status: 401, headers: extensionCorsHeaders });
  if (!await isExtensaoVitrineEnabled(integration.account_id)) return NextResponse.json({ error: "Não liberado." }, { status: 403, headers: extensionCorsHeaders });
  const body = await request.json().catch(() => null);
  const responses = Array.isArray(body?.responses) ? body.responses.slice(0, 60) : [];
  if (!responses.length) return NextResponse.json({ cupons: 0 }, { headers: extensionCorsHeaders });
  try {
    return NextResponse.json(await importShopeeCoupons(responses), { headers: extensionCorsHeaders });
  } catch (error) {
    console.error({ event: "shopee_coupons_import_failed", error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ error: "Falha ao guardar cupons." }, { status: 500, headers: extensionCorsHeaders });
  }
}
