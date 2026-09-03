import { NextRequest, NextResponse } from "next/server";
import { extensionCorsHeaders, requireMercadoLivreCatalogCollector } from "@/modules/offer-autopilot/server/mercado-livre-extension";
import { mercadoLivreExtensionImportSchema, mercadoLivreExtensionProductSchema } from "@/modules/affiliate-catalog/mercado-livre-import-schema";
import { importMercadoLivreExtensionProducts } from "@/modules/affiliate-catalog/server/mercado-livre-catalog-service";

export const runtime = "nodejs";
export function OPTIONS() { return new NextResponse(null, { status: 204, headers: extensionCorsHeaders }); }

export async function POST(request: NextRequest) {
  if (!await requireMercadoLivreCatalogCollector(request)) return NextResponse.json({ error: "Extensão não autorizada." }, { status: 401, headers: extensionCorsHeaders });
  const raw = await request.json().catch(() => null); const envelope = mercadoLivreExtensionImportSchema.safeParse(raw);
  if (!envelope.success) return NextResponse.json({ error: "Envie de 1 a 500 produtos no formato da extensão." }, { status: 400, headers: extensionCorsHeaders });
  const inherited = "captured_at" in envelope.data ? envelope.data.captured_at : undefined;
  const pageUrl = "page_url" in envelope.data ? envelope.data.page_url : undefined;
  const body = envelope.data.products;
  const parsed = body.map(item => mercadoLivreExtensionProductSchema.safeParse(typeof item === "object" && item ? { ...item, captured_at: (item as any).captured_at || inherited, source_page: (item as any).source_page || pageUrl } : item));
  const valid = parsed.flatMap(result => result.success ? [result.data] : []);
  const errors = parsed.length - valid.length;
  if (!valid.length) return NextResponse.json({ received: body.length, inserted: 0, updated: 0, errors }, { status: 422, headers: extensionCorsHeaders });
  try {
    return NextResponse.json(await importMercadoLivreExtensionProducts(valid, body.length, errors), { headers: extensionCorsHeaders });
  } catch (error) {
    console.error({ event: "mercado_livre_extension_catalog_import_failed", error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ error: "Não foi possível importar o catálogo.", received: body.length, inserted: 0, updated: 0, errors: errors + valid.length }, { status: 500, headers: extensionCorsHeaders });
  }
}
