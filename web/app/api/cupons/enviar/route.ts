import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { env } from "@/lib/env";
import { guardAdminMutation, requireAccountContext } from "@/lib/security";
import { supabaseAdmin } from "@/lib/supabase";
import { isExtensaoVitrineEnabled } from "@/modules/affiliate-catalog/server/catalog-agenda-service";
import { CatalogDispatchError, createCatalogDispatch, resolveCatalogTarget } from "@/modules/affiliate-catalog/server/catalog-dispatch-service";
import { shopeeAffiliateLink, StoreLinkError } from "@/modules/affiliate-catalog/server/store-link-service";

const base = { message: z.string().trim().min(1).max(4000), senderId: z.string().uuid(), groupJids: z.array(z.string()).min(1).max(500) };
const schema = z.union([
  z.object({ tipo: z.literal("cupom"), promotionId: z.string().min(1).max(64), ...base }),
  z.object({ tipo: z.literal("oferta"), offerLink: z.string().url(), name: z.string().min(1).max(200), imageUrl: z.string().url().optional(), ...base })
]);
const LINK_OK = /https:\/\/(?:s\.shopee\.com\.br|shope\.ee)\/[A-Za-z0-9]+/;
const imagemShopee = (url?: string) => { if (!url) return false; try { const hn = new URL(url).hostname; return /(^|\.)shopee\.com\.br$|susercontent/i.test(hn) || url.startsWith(env().NEXT_PUBLIC_APP_URL); } catch { return false; } };

export async function POST(request: NextRequest) {
  const guard = await guardAdminMutation(request, "cupom_dispatch_ip"); if (guard) return guard;
  const context = await requireAccountContext(); if (context.error) return context.error;
  if (!await isExtensaoVitrineEnabled(context.accountId)) return NextResponse.json({ error: "Área não liberada." }, { status: 403 });
  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || "Dados inválidos." }, { status: 400 });
  const d = parsed.data;
  let message = d.message;
  const linkNaMensagem = message.match(LINK_OK)?.[0];

  try {
    let affiliateUrl: string; let name: string; let imageUrl: string | undefined; let externalItemId: string;
    if (d.tipo === "cupom") {
      const { data: cupom } = await supabaseAdmin().from("shopee_coupons").select("*").eq("promotion_id", d.promotionId).eq("active", true).maybeSingle();
      if (!cupom) return NextResponse.json({ error: "Cupom não está mais disponível." }, { status: 404 });
      // Usa o link que já está na mensagem (evita link duplicado); só gera se não houver.
      affiliateUrl = linkNaMensagem || await shopeeAffiliateLink(context.database, context.accountId, cupom.redirect_url && /shopee\.com\.br/i.test(cupom.redirect_url) ? cupom.redirect_url : "https://shopee.com.br/m/cupom-de-desconto");
      name = (cupom.bold_text || "Cupom Shopee").slice(0, 120);
      imageUrl = `${env().NEXT_PUBLIC_APP_URL}/api/cupons/imagem?bold=${encodeURIComponent(cupom.bold_text || "CUPOM")}&cat=${encodeURIComponent(cupom.icon_text || "")}`;
      externalItemId = `cupom_${cupom.voucher_code}`;
    } else {
      affiliateUrl = linkNaMensagem && LINK_OK.test(d.offerLink) ? linkNaMensagem : d.offerLink;
      name = d.name.slice(0, 120); imageUrl = imagemShopee(d.imageUrl) ? d.imageUrl : undefined; externalItemId = `oferta_${d.offerLink.split("/").pop()}`;
    }
    if (!LINK_OK.test(affiliateUrl)) return NextResponse.json({ error: "Link de afiliado inválido." }, { status: 400 });
    if (!message.includes(affiliateUrl)) message = `${message}\n🛒 ${affiliateUrl}`;

    const usaImagem = imagemShopee(imageUrl);
    const target = await resolveCatalogTarget(context.accountId, { senderId: d.senderId, groupJids: d.groupJids, imageMode: usaImagem ? "original_image" : "product_link_preview" });
    const result = await createCatalogDispatch({
      accountId: context.accountId, userId: context.session.userId ?? null,
      offer: { provider: "SHOPEE", externalItemId, name, imageUrl: usaImagem ? imageUrl : undefined, affiliateUrl },
      message, target, imageMode: usaImagem ? "original_image" : "product_link_preview"
    });
    return NextResponse.json({ ok: true, total: result.total });
  } catch (error) {
    if (error instanceof StoreLinkError) return NextResponse.json({ error: error.message }, { status: error.status });
    if (error instanceof CatalogDispatchError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error({ event: "cupom_oferta_enviar_falhou", account_id: context.accountId, error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ error: "Não foi possível enviar." }, { status: 500 });
  }
}
