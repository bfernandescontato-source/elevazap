import { NextRequest, NextResponse } from "next/server";
import { extensionCorsHeaders, requireMercadoLivreExtension } from "@/modules/offer-autopilot/server/mercado-livre-extension";
import { isExtensaoVitrineEnabled } from "@/modules/affiliate-catalog/server/catalog-agenda-service";
import { dailyImportSchema } from "@/modules/affiliate-catalog/daily-import-schema";
import { importStoreOffers } from "@/modules/affiliate-catalog/server/store-catalog-service";

export const runtime = "nodejs";
export function OPTIONS() { return new NextResponse(null, { status: 204, headers: extensionCorsHeaders }); }

// Recebe as ofertas do dia (Amazon/Magalu) da coleta diária da extensão.
export async function POST(request: NextRequest) {
  const integration = await requireMercadoLivreExtension(request);
  if (!integration) return NextResponse.json({ error: "Extensão não autorizada." }, { status: 401, headers: extensionCorsHeaders });
  if (!await isExtensaoVitrineEnabled(integration.account_id)) return NextResponse.json({ error: "Coleta não liberada para esta conta." }, { status: 403, headers: extensionCorsHeaders });
  const parsed = dailyImportSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Formato inválido." }, { status: 400, headers: extensionCorsHeaders });
  try {
    return NextResponse.json(await importStoreOffers(parsed.data.provider, parsed.data.offers), { headers: extensionCorsHeaders });
  } catch (error) {
    console.error({ event: "catalog_daily_import_failed", provider: parsed.data.provider, error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ error: "Não foi possível guardar as ofertas." }, { status: 500, headers: extensionCorsHeaders });
  }
}
