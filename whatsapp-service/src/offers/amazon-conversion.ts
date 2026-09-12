import type { SupabaseClient } from "@supabase/supabase-js";
import { convertAmazonLink, validateAmazonAffiliateUrl } from "@disparei/affiliate-links/amazon";
import { replaceUrlPreservingText } from "./shopee-url-resolver.js";
import type { ParsedOffer } from "./types.js";

type Context = { accountId: string; automationId: string; offerId: string; sourceGroupId: string };
export type AmazonConversionResult = { processedText: string; converted: boolean; affiliateLink?: string; originalLink?: string; resolvedUrl?: string; affiliateTag?: string };

export class AmazonOfferConverter {
  constructor(private database: SupabaseClient, private convertLink = convertAmazonLink) {}

  async convert(parsed: ParsedOffer, context: Context, initialText = parsed.text): Promise<AmazonConversionResult> {
    const { data: integration, error } = await this.database.from("affiliate_integrations")
      .select("status,affiliate_tag").eq("account_id", context.accountId).eq("provider", "amazon").maybeSingle();
    if (error) throw error;
    if (!integration || integration.status !== "connected" || !integration.affiliate_tag) throw new Error("Configure seu ID de Associado Amazon antes de ativar a conversão.");

    const partnerTag = integration.affiliate_tag as string;
    let processedText = initialText;
    let primary: Omit<AmazonConversionResult, "processedText" | "converted"> | undefined;
    for (const originalLink of parsed.amazonLinks) {
      const converted = await this.convertLink(originalLink, partnerTag);
      if (!validateAmazonAffiliateUrl(converted.affiliate_url, partnerTag)) throw new Error("O link Amazon convertido não passou na validação de segurança.");
      processedText = replaceUrlPreservingText(processedText, originalLink, converted.affiliate_url);
      primary ||= { originalLink, resolvedUrl: converted.resolved_url, affiliateLink: converted.affiliate_url, affiliateTag: partnerTag };
    }
    return { processedText, ...primary, converted: parsed.amazonLinks.length > 0 && Boolean(primary?.affiliateLink) };
  }
}
