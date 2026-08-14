import type { SupabaseClient } from "@supabase/supabase-js";
import { createHash } from "crypto";
import { decryptIntegrationSecret } from "../utils/integration-crypto.js";
import { RealShopeeAffiliateService } from "./shopee-affiliate-service.js";
import { replaceUrlPreservingText } from "./shopee-url-resolver.js";
import type { ParsedOffer } from "./types.js";

type ConversionContext = { accountId: string; automationId: string; offerId: string; sourceGroupId: string };
export type ConversionResult = { processedText: string; originalLink?: string; resolvedUrl?: string; affiliateLink?: string; shopId?: string; itemId?: string; converted: boolean; duplicateOfferId?: string };

function token(prefix: string, value: string) { return `${prefix}-${createHash("sha256").update(value).digest("hex").slice(0, 12)}`; }
function log(event: string, context: ConversionContext, fields: Record<string, unknown> = {}) { console.info({ event, component: "shopee-affiliate", account_id: context.accountId, automation_id: context.automationId, offer_id: context.offerId, ...fields }); }

export class ShopeeOfferConverter {
  constructor(private database: SupabaseClient, private shopee = new RealShopeeAffiliateService()) {}

  async convert(parsed: ParsedOffer, context: ConversionContext, initialText = parsed.text): Promise<ConversionResult> {
    const { data: integration, error } = await this.database.from("affiliate_integrations").select("app_id,encrypted_app_secret,credential_fingerprint,status")
      .eq("account_id", context.accountId).eq("provider", "shopee").eq("status", "connected").maybeSingle();
    if (error) throw error;
    if (!integration) throw new Error("Conecte sua conta Shopee Affiliate antes de ativar a conversão.");
    let processedText = initialText;
    let primary: Omit<ConversionResult, "processedText" | "converted"> | undefined;
    for (const originalLink of parsed.shopeeLinks) {
      log("shopee_url_detected", context);
      const resolvedUrl = await this.shopee.resolveUrl(originalLink);
      const identifiers = this.shopee.extractProductIdentifiers(resolvedUrl);
      if (!identifiers.itemId) {
        log("shopee_url_ambiguous", context);
        continue;
      }
      log("shopee_url_resolved", context, { item_id: identifiers.itemId });
      const { data: duplicate } = await this.database.from("captured_offers").select("id").eq("account_id", context.accountId)
        .eq("item_id", identifiers.itemId).neq("id", context.offerId).gte("captured_at", new Date(Date.now() - 24 * 3_600_000).toISOString())
        .not("status", "in", '(ignored,duplicate,processing_failed)').limit(1).maybeSingle();
      if (duplicate) return { processedText, originalLink, resolvedUrl, ...identifiers, converted: false, duplicateOfferId: duplicate.id };
      const resolvedHash = createHash("sha256").update(resolvedUrl).digest("hex");
      const { data: cached } = await this.database.from("affiliate_link_cache").select("affiliate_link").eq("account_id", context.accountId)
        .eq("provider", "shopee").eq("credential_fingerprint", integration.credential_fingerprint).eq("resolved_url_hash", resolvedHash)
        .eq("affiliate_tag", "").gt("expires_at", new Date().toISOString()).maybeSingle();
      let affiliateLink = cached?.affiliate_link;
      if (!affiliateLink) {
        await this.database.from("captured_offers").update({ affiliate_conversion_status: "generating", updated_at: new Date().toISOString() })
          .eq("id", context.offerId).eq("account_id", context.accountId);
        log("shopee_affiliate_generation_started", context, { item_id: identifiers.itemId });
        affiliateLink = await this.shopee.generateAffiliateLink(resolvedUrl, {
          appId: integration.app_id,
          appSecret: decryptIntegrationSecret(integration.encrypted_app_secret)
        }, {
          acc: token("a", context.accountId), auto: token("u", context.automationId),
          src: token("s", context.sourceGroupId), offer: token("o", context.offerId), channel: "whatsapp"
        });
        const { error: cacheError } = await this.database.from("affiliate_link_cache").upsert({
          account_id: context.accountId, provider: "shopee", credential_fingerprint: integration.credential_fingerprint,
          item_id: identifiers.itemId, resolved_url_hash: resolvedHash, resolved_url: resolvedUrl, affiliate_link: affiliateLink,
          affiliate_tag: "",
          expires_at: new Date(Date.now() + 30 * 24 * 3_600_000).toISOString()
        }, { onConflict: "account_id,provider,credential_fingerprint,resolved_url_hash,affiliate_tag" });
        if (cacheError) throw cacheError;
      }
      processedText = replaceUrlPreservingText(processedText, originalLink, affiliateLink);
      primary ||= { originalLink, resolvedUrl, affiliateLink, ...identifiers };
      log("shopee_affiliate_generated", context, { item_id: identifiers.itemId, cache_hit: Boolean(cached) });
    }
    return { processedText, ...primary, converted: Boolean(primary?.affiliateLink) };
  }
}
