import { NextRequest, NextResponse } from "next/server";
import { requireAccountContext } from "@/lib/security";
import { offerBadgePreviewSchema, SAMPLE_DISCOUNT_PERCENT } from "@/modules/offer-images/schemas";
import { renderBadgeSample } from "@/modules/offer-images/server/offer-image-composer";

// Foto de exemplo com os selos, desenhada pelo mesmo código dos envios.
export async function GET(request: NextRequest) {
  const context = await requireAccountContext(); if (context.error) return context.error;
  const parsed = offerBadgePreviewSchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!parsed.success) return NextResponse.json({ error: "Dados inválidos." }, { status: 400 });
  const { mode, discount, freeShipping } = parsed.data;
  try {
    const image = await renderBadgeSample(mode, {
      ...(discount === "1" ? { discountPercent: SAMPLE_DISCOUNT_PERCENT } : {}),
      ...(freeShipping === "1" ? { freeShipping: true as const } : {})
    });
    return new NextResponse(new Uint8Array(image), { headers: { "content-type": "image/jpeg", "cache-control": "private, max-age=300" } });
  } catch {
    return NextResponse.json({ error: "Prévia indisponível agora." }, { status: 503 });
  }
}
