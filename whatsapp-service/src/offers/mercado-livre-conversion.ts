import type { SupabaseClient } from "@supabase/supabase-js";
import { createHash } from "crypto";
import { replaceUrlPreservingText } from "./shopee-url-resolver.js";
import { MercadoLivreAffiliateService, MercadoLivreSessionExpiredError } from "./mercado-livre-affiliate-service.js";
import type { ParsedOffer } from "./types.js";

type Context = { accountId: string; automationId: string; offerId: string; sourceGroupId: string };
export type MercadoLivreConversionResult = { processedText: string; converted: boolean; affiliateLink?: string; originalLink?: string; resolvedUrl?: string; itemId?: string; catalogProductId?: string; affiliateTag?: string; duplicateOfferId?: string };

function log(event: string, context: Context, fields: Record<string, unknown> = {}) {
  console.info({ event, component: "mercado-livre-affiliate", account_id: context.accountId, automation_id: context.automationId, offer_id: context.offerId, ...fields });
}

export class MercadoLivreOfferConverter {
  constructor(private database: SupabaseClient, private service = new MercadoLivreAffiliateService(database)) {}

  async convert(parsed: ParsedOffer, context: Context, initialText = parsed.text): Promise<MercadoLivreConversionResult> {
    const { data: integration, error } = await this.database.from("affiliate_integrations")
      .select("id,status,affiliate_tag,extension_token_hash").eq("account_id", context.accountId).eq("provider", "mercado_livre").maybeSingle();
    if (error) throw error;
    if (!integration || integration.status !== "connected" || !integration.extension_token_hash) throw new Error("Conecte sua conta Mercado Livre antes de ativar a conversão.");
    let processedText = initialText;
    let primary: Omit<MercadoLivreConversionResult, "processedText" | "converted"> | undefined;
    for (let position = 0; position < parsed.mercadoLivreLinks.length; position += 1) {
      const originalLink = parsed.mercadoLivreLinks[position];
      log("mercado_livre_url_detected", context);
      const product = await this.service.resolveUrl(originalLink);
      if (!product.itemId && !product.catalogProductId) throw new Error("O link não pôde ser associado com segurança a um produto Mercado Livre.");
      log("mercado_livre_url_resolved", context, { item_id: product.itemId, catalog_product_id: product.catalogProductId });
      const identity = product.itemId || product.catalogProductId!;
      const { data: duplicate } = await this.database.from("captured_offer_links").select("offer_id")
        .eq("account_id", context.accountId).eq("provider", "mercado_livre").eq("item_id", identity)
        .neq("offer_id", context.offerId).gte("created_at", new Date(Date.now() - 24 * 3_600_000).toISOString()).limit(1).maybeSingle();
      if (duplicate) return { processedText, originalLink, resolvedUrl: product.resolvedUrl, itemId: product.itemId, catalogProductId: product.catalogProductId, converted: false, duplicateOfferId: duplicate.offer_id };
      const { data: offerLink, error: linkError } = await this.database.from("captured_offer_links").upsert({
        account_id: context.accountId, offer_id: context.offerId, provider: "mercado_livre", position,
        original_url: originalLink, resolved_url: product.resolvedUrl, item_id: product.itemId || identity,
        catalog_product_id: product.catalogProductId || null, affiliate_tag: integration.affiliate_tag || null,
        conversion_status: "generating", attempts: 1, updated_at: new Date().toISOString()
      }, { onConflict: "offer_id,original_url" }).select("id").single();
      if (linkError) throw linkError;
      const fingerprint = this.service.cacheFingerprint(integration.extension_token_hash);
      const affiliateTag = integration.affiliate_tag || "";
      const resolvedHash = createHash("sha256").update(product.resolvedUrl).digest("hex");
      const { data: cached } = await this.database.from("affiliate_link_cache").select("affiliate_link")
        .eq("account_id", context.accountId).eq("provider", "mercado_livre").eq("credential_fingerprint", fingerprint)
        .eq("resolved_url_hash", resolvedHash).eq("affiliate_tag", affiliateTag).gt("expires_at", new Date().toISOString()).maybeSingle();
      let affiliateLink = cached?.affiliate_link as string | undefined;
      if (!affiliateLink) {
        log("mercado_livre_affiliate_generation_started", context, { item_id: product.itemId });
        try {
          affiliateLink = await this.service.generateAffiliateLink(product, { accountId: context.accountId, offerLinkId: offerLink.id, affiliateTag: integration.affiliate_tag });
        } catch (generationError) {
          if (generationError instanceof MercadoLivreSessionExpiredError) {
            await this.database.from("affiliate_integrations").update({ status: "expired", last_error: generationError.message, updated_at: new Date().toISOString() }).eq("id", integration.id).eq("account_id", context.accountId);
            log("mercado_livre_session_expired", context);
          }
          throw generationError;
        }
        await this.database.from("affiliate_link_cache").upsert({
          account_id: context.accountId, provider: "mercado_livre", credential_fingerprint: fingerprint,
          item_id: identity, resolved_url_hash: resolvedHash, resolved_url: product.resolvedUrl,
          affiliate_link: affiliateLink, affiliate_tag: affiliateTag,
          expires_at: new Date(Date.now() + 30 * 24 * 3_600_000).toISOString()
        }, { onConflict: "account_id,provider,credential_fingerprint,resolved_url_hash,affiliate_tag" });
      }
      processedText = replaceUrlPreservingText(processedText, originalLink, affiliateLink);
      await this.database.from("captured_offer_links").update({ affiliate_link: affiliateLink, conversion_status: "converted", converted_at: new Date().toISOString(), conversion_error: null, updated_at: new Date().toISOString() }).eq("id", offerLink.id).eq("account_id", context.accountId);
      primary ||= { originalLink, resolvedUrl: product.resolvedUrl, affiliateLink, itemId: product.itemId, catalogProductId: product.catalogProductId, affiliateTag: integration.affiliate_tag || undefined };
      log("mercado_livre_affiliate_generated", context, { item_id: product.itemId, cache_hit: Boolean(cached) });
    }
    return { processedText, ...primary, converted: Boolean(primary?.affiliateLink) };
  }
}
