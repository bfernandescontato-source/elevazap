import { NextRequest, NextResponse } from "next/server";
import { guardAdminMutation, requireAccountContext } from "@/lib/security";
import { storyRequestSchema } from "@/modules/offer-story/schemas";
import { storyFileName } from "@/modules/offer-story/story-layout";
import { renderStoryForOffer } from "@/modules/offer-story/server/status-post-service";

export const runtime = "nodejs";

/** "Baixar story": devolve a arte 9:16 da oferta (JPEG) para postar no Status ou no Instagram. */
export async function POST(request: NextRequest) {
  const guard = await guardAdminMutation(request, "catalog_story_ip"); if (guard) return guard;
  const context = await requireAccountContext(); if (context.error) return context.error;
  const parsed = storyRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || "Dados inválidos." }, { status: 400 });
  try {
    const image = await renderStoryForOffer(parsed.data.offer);
    return new NextResponse(new Uint8Array(image), {
      headers: {
        "content-type": "image/jpeg",
        "content-disposition": `attachment; filename="${storyFileName(parsed.data.offer)}"`,
        "cache-control": "no-store"
      }
    });
  } catch (error) {
    console.error({ event: "offer_story_render_failed", component: "offer-story", account_id: context.accountId, message: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ error: "Não foi possível criar o story agora." }, { status: 500 });
  }
}
