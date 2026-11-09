import { NextRequest, NextResponse } from "next/server";
import { guardAdminMutation, requireAccountContext } from "@/lib/security";
import { offerImageSettingsSchema } from "@/modules/offer-images/schemas";
import { getOfferImageSettings, OfferImageSettingsError, saveOfferImageSettings } from "@/modules/offer-images/server/offer-image-settings-service";

// Formato padrão da imagem das ofertas e selos na foto, por conta.
export async function GET() {
  const context = await requireAccountContext(); if (context.error) return context.error;
  return NextResponse.json({ settings: await getOfferImageSettings(context.accountId) });
}

export async function PUT(request: NextRequest) {
  const guard = await guardAdminMutation(request, "offer_image_settings_ip"); if (guard) return guard;
  const context = await requireAccountContext(); if (context.error) return context.error;
  const parsed = offerImageSettingsSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Dados inválidos." }, { status: 400 });
  try {
    const settings = await saveOfferImageSettings(context.accountId, context.session.userId ?? null, parsed.data);
    return NextResponse.json({ settings: { ...settings, saved: true } });
  } catch (error) {
    if (error instanceof OfferImageSettingsError) return NextResponse.json({ error: error.message }, { status: 500 });
    throw error;
  }
}
