import { NextRequest, NextResponse } from "next/server";
import { requireAccountContext, requireValidOrigin } from "@/lib/security";
import { offerPageSettingsSchema } from "@/modules/offer-page/schemas";
import { getOwnOfferPage, OfferPageError, saveOwnOfferPage } from "@/modules/offer-page/server/offer-page-service";

function failure(error: unknown) {
  if (error instanceof OfferPageError) return NextResponse.json({ error: error.message }, { status: error.status });
  console.error({ event: "offer_page_failed", component: "offer-page", message: error instanceof Error ? error.message : String(error) });
  return NextResponse.json({ error: "Não foi possível concluir. Tente de novo." }, { status: 500 });
}

export async function GET() {
  const context = await requireAccountContext();
  if (context.error) return context.error;
  try { return NextResponse.json(await getOwnOfferPage(context), { headers: { "cache-control": "no-store" } }); }
  catch (error) { return failure(error); }
}

export async function PUT(request: NextRequest) {
  const origin = requireValidOrigin(request);
  if (origin) return origin;
  const context = await requireAccountContext();
  if (context.error) return context.error;
  const parsed = offerPageSettingsSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || "Dados inválidos." }, { status: 400 });
  try { return NextResponse.json(await saveOwnOfferPage(context, parsed.data)); }
  catch (error) { return failure(error); }
}
