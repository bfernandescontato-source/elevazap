import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { guardAdminMutation, requireAccountContext } from "@/lib/security";
import { supabaseAdmin } from "@/lib/supabase";
import { isExtensaoVitrineEnabled } from "@/modules/affiliate-catalog/server/catalog-agenda-service";
import { CatalogDispatchError, createCatalogDispatch, resolveCatalogTarget } from "@/modules/affiliate-catalog/server/catalog-dispatch-service";
import { shopeeAffiliateLink, StoreLinkError } from "@/modules/affiliate-catalog/server/store-link-service";

const schema = z.object({
  promotionId: z.string().min(1).max(64),
  senderId: z.string().uuid(),
  groupJids: z.array(z.string()).min(1).max(500),
  extraMessage: z.string().max(600).optional()
});

export async function POST(request: NextRequest) {
  const guard = await guardAdminMutation(request, "cupom_dispatch_ip"); if (guard) return guard;
  const context = await requireAccountContext(); if (context.error) return context.error;
  if (!await isExtensaoVitrineEnabled(context.accountId)) return NextResponse.json({ error: "Área de cupons não liberada." }, { status: 403 });
  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || "Dados inválidos." }, { status: 400 });
  const { promotionId, senderId, groupJids, extraMessage } = parsed.data;

  const { data: cupom } = await supabaseAdmin().from("shopee_coupons").select("*").eq("promotion_id", promotionId).eq("active", true).maybeSingle();
  if (!cupom) return NextResponse.json({ error: "Cupom não está mais disponível." }, { status: 404 });

  try {
    // Link de afiliado rastreado (sem isso o afiliado não ganha comissão).
    const destino = cupom.redirect_url && /shopee\.com\.br/i.test(cupom.redirect_url) ? cupom.redirect_url : "https://shopee.com.br/m/cupom-de-desconto";
    const affiliateUrl = await shopeeAffiliateLink(context.database, context.accountId, destino);

    const linhas = [
      `🎟️ ${cupom.bold_text || "Cupom Shopee"}${cupom.light_text ? ` — ${cupom.light_text}` : ""}`,
      `🔑 Use o cupom: ${cupom.voucher_code}`,
      extraMessage?.trim() ? extraMessage.trim() : null,
      `🛒 ${affiliateUrl}`,
      "⏰ Corre que é limitado, acaba rápido!"
    ].filter(Boolean);
    const message = linhas.join("\n");

    const target = await resolveCatalogTarget(context.accountId, { senderId, groupJids, imageMode: "product_link_preview" });
    const result = await createCatalogDispatch({
      accountId: context.accountId, userId: context.session.userId ?? null,
      offer: { provider: "SHOPEE", externalItemId: `cupom_${cupom.voucher_code}`, name: (cupom.bold_text || "Cupom Shopee").slice(0, 120), affiliateUrl },
      message, target, imageMode: "product_link_preview"
    });
    return NextResponse.json({ ok: true, total: result.total });
  } catch (error) {
    if (error instanceof StoreLinkError) return NextResponse.json({ error: error.message }, { status: error.status });
    if (error instanceof CatalogDispatchError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error({ event: "cupom_enviar_falhou", account_id: context.accountId, error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ error: "Não foi possível enviar o cupom." }, { status: 500 });
  }
}
