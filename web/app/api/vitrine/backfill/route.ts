import { NextRequest, NextResponse } from "next/server";
import { persistentRateLimit, requireAccountContext, requireValidOrigin } from "@/lib/security";
import { offerPageBackfillSchema } from "@/modules/offer-page/schemas";
import { backfillOwnOfferPage, OfferPageError } from "@/modules/offer-page/server/offer-page-service";

// Carga inicial da vitrine: cada chamada processa um lote curto (300 envios) e
// devolve o cursor do próximo. A conta vem só da sessão.
export async function POST(request: NextRequest) {
  const origin = requireValidOrigin(request);
  if (origin) return origin;
  const context = await requireAccountContext();
  if (context.error) return context.error;
  const parsed = offerPageBackfillSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Dados inválidos." }, { status: 400 });
  const allowed = await persistentRateLimit(context.accountId, "offer_page_backfill", 120, 600).catch(() => true);
  if (!allowed) return NextResponse.json({ error: "Muitas tentativas. Aguarde alguns minutos." }, { status: 429 });
  try { return NextResponse.json(await backfillOwnOfferPage(context.accountId, parsed.data)); }
  catch (error) {
    const status = error instanceof OfferPageError ? error.status : 500;
    return NextResponse.json({ error: error instanceof OfferPageError ? error.message : "Não foi possível buscar suas ofertas enviadas." }, { status });
  }
}
