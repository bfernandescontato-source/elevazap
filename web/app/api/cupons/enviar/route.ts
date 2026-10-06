import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { guardAdminMutation, requireAccountContext } from "@/lib/security";
import { isExtensaoVitrineEnabled } from "@/modules/affiliate-catalog/server/catalog-agenda-service";
import { CatalogDispatchError, createCatalogDispatch, resolveCatalogTarget } from "@/modules/affiliate-catalog/server/catalog-dispatch-service";

const schema = z.object({
  offerLink: z.string().url(),
  name: z.string().min(1).max(200),
  imageUrl: z.string().url().optional(),
  message: z.string().trim().min(1).max(4000),
  senderId: z.string().uuid(),
  groupJids: z.array(z.string()).min(1).max(500)
});
const LINK_OK = /^https:\/\/(?:s\.shopee\.com\.br|shope\.ee)\/[A-Za-z0-9]+/;

export async function POST(request: NextRequest) {
  const guard = await guardAdminMutation(request, "cupom_dispatch_ip"); if (guard) return guard;
  const context = await requireAccountContext(); if (context.error) return context.error;
  if (!await isExtensaoVitrineEnabled(context.accountId)) return NextResponse.json({ error: "Área não liberada." }, { status: 403 });
  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || "Dados inválidos." }, { status: 400 });
  const { offerLink, name, imageUrl, senderId, groupJids } = parsed.data;
  if (!LINK_OK.test(offerLink)) return NextResponse.json({ error: "Link de oferta inválido." }, { status: 400 });

  let message = parsed.data.message;
  if (!message.includes(offerLink)) message = `${message}\n🛒 ${offerLink}`;
  const imagemOk = imageUrl && /(^|\.)shopee\.com\.br$|susercontent/i.test((() => { try { return new URL(imageUrl).hostname; } catch { return ""; } })());

  try {
    const target = await resolveCatalogTarget(context.accountId, { senderId, groupJids, imageMode: imagemOk ? "original_image" : "product_link_preview" });
    const result = await createCatalogDispatch({
      accountId: context.accountId, userId: context.session.userId ?? null,
      offer: { provider: "SHOPEE", externalItemId: `oferta_${offerLink.split("/").pop()}`, name: name.slice(0, 120), imageUrl: imagemOk ? imageUrl : undefined, affiliateUrl: offerLink },
      message, target, imageMode: imagemOk ? "original_image" : "product_link_preview"
    });
    return NextResponse.json({ ok: true, total: result.total });
  } catch (error) {
    if (error instanceof CatalogDispatchError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error({ event: "oferta_shopee_enviar_falhou", account_id: context.accountId, error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ error: "Não foi possível enviar a oferta." }, { status: 500 });
  }
}
