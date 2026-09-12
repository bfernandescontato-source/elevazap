import type { SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "crypto";
import { isSupportedMarketplaceUrl, parseOffer } from "./offer-parser.js";
import type { RawOfferMessage } from "./types.js";
import { ShopeeOfferConverter } from "./shopee-conversion.js";
import { offerFeatureFlags } from "./feature-flags.js";
import { OfferAiRewriter, sanitizeSourcePromotion } from "./offer-ai-rewriter.js";
import { MercadoLivreOfferConverter } from "./mercado-livre-conversion.js";
import { AmazonOfferConverter } from "./amazon-conversion.js";
import { env } from "../env.js";
import { sharedMediaCache } from "../utils/media.js";

type Automation = {
  id: string;
  account_id: string;
  created_by: string | null;
  whatsapp_sender_id: string;
  interval_minutes: number;
  operating_start: string;
  operating_end: string;
  timezone: string;
  keep_original_text: boolean;
  keep_original_media: boolean;
  ai_rewrite_enabled: boolean;
  shopee_conversion_enabled: boolean;
  mercado_livre_conversion_enabled: boolean;
  conversion_failure_policy: "pause" | "send_original";
  whatsapp_senders: { session_name: string } | { session_name: string }[];
};

function log(event: string, fields: Record<string, unknown>) {
  console.info({ event, component: "offer-autopilot", ...fields });
}

export class OfferProcessor {
  constructor(private database: SupabaseClient, private amazonConverter = new AmazonOfferConverter(database)) {}

  private processingLease() {
    return {
      processing_worker_id: env.INSTANCE_ID,
      processing_deadline_at: new Date(Date.now() + env.OFFER_PROCESSING_TIMEOUT_MS).toISOString()
    };
  }

  private async automationEnabled(automation: Automation) {
    const { data, error } = await this.database.from("offer_automations").select("enabled")
      .eq("id", automation.id).eq("account_id", automation.account_id).maybeSingle();
    if (error) throw error;
    return data?.enabled === true;
  }

  private async stopIfDisabled(automation: Automation, offerId: string) {
    if (await this.automationEnabled(automation)) return false;
    await this.database.from("captured_offers").update({
      status: "ignored", error_code: "PILOT_DISABLED", error_message: "Piloto Automático desativado.",
      processed_at: new Date().toISOString(), processing_worker_id: null,
      processing_deadline_at: null, updated_at: new Date().toISOString()
    }).eq("id", offerId).eq("account_id", automation.account_id)
      .eq("status", "processing").eq("processing_worker_id", env.INSTANCE_ID);
    log("offer_cancelled_pilot_disabled", { account_id: automation.account_id, automation_id: automation.id, offer_id: offerId });
    return true;
  }

  async resume(accountId: string, offerId: string) {
    const { data: offer, error } = await this.database.from("captured_offers").select("*")
      .eq("id", offerId).eq("account_id", accountId).eq("status", "processing")
      .eq("processing_worker_id", env.INSTANCE_ID).maybeSingle();
    if (error) throw error;
    if (!offer) return null;
    const { data: automation, error: automationError } = await this.database.from("offer_automations")
      .select("*,whatsapp_senders(session_name)").eq("id", offer.automation_id).eq("account_id", accountId).maybeSingle();
    if (automationError) throw automationError;
    if (!automation) throw new Error("Automação não encontrada para recuperar a oferta.");

    if (!offer.original_text && (!offer.media_bucket || !offer.media_path)) {
      const message = "A oferta foi preservada, mas a mídia original não estava disponível após o reinício.";
      await this.database.from("captured_offers").update({
        status: "processing_failed", error_code: "SOURCE_MEDIA_UNAVAILABLE", error_message: message,
        processed_at: new Date().toISOString(), processing_worker_id: null,
        processing_deadline_at: null, updated_at: new Date().toISOString()
      }).eq("id", offer.id).eq("account_id", accountId).eq("status", "processing")
        .eq("processing_worker_id", env.INSTANCE_ID);
      return { ...offer, status: "processing_failed", error_code: "SOURCE_MEDIA_UNAVAILABLE", error_message: message };
    }

    let media: RawOfferMessage["media"];
    if (offer.media_bucket && offer.media_path) {
      const key = `${offer.media_bucket}:${offer.media_path}`;
      const buffer = await sharedMediaCache.getOrLoad(key, async () => {
        const { data, error: mediaError } = await this.database.storage.from(offer.media_bucket).download(offer.media_path);
        if (mediaError) throw mediaError;
        return Buffer.from(await data.arrayBuffer());
      });
      const mimeType = offer.media_mime_type || "image/jpeg";
      media = { buffer, mimeType, extension: mimeType === "image/png" ? "png" : mimeType === "image/webp" ? "webp" : "jpg" };
    }
    return this.process(automation as Automation, {
      sourceType: offer.source_type,
      sourceMessageId: offer.source_message_id,
      sourceGroupId: offer.source_group_id,
      senderId: offer.sender_id || undefined,
      text: offer.original_text || "",
      media,
      timestamp: new Date(offer.captured_at)
    }, offer);
  }

  async process(automation: Automation, message: RawOfferMessage, existingOffer?: any) {
    if (!(await this.automationEnabled(automation))) return null;
    const parsed = parseOffer(message);
    if (!parsed.text && !parsed.media && !message.hasMedia) return null;
    const common = { account_id: automation.account_id, automation_id: automation.id, source_group_id: parsed.sourceGroupId };
    log("offer_parsed", { ...common, source_message_id: parsed.sourceMessageId, link_count: parsed.links.length });

    const shopeeConversionRequired = parsed.shopeeLinks.length > 0 && automation.shopee_conversion_enabled;
    const mercadoLivreConversionRequired = parsed.mercadoLivreLinks.length > 0 && automation.mercado_livre_conversion_enabled;
    const amazonConversionRequired = parsed.amazonLinks.length > 0;
    // Nunca repasse links de lojas ainda não integradas, nem mensagens sem link de marketplace.
    const unsupportedLinks = parsed.links.filter((value) => !isSupportedMarketplaceUrl(value));
    const hasSupportedMarketplaceLink = parsed.shopeeLinks.length > 0 || parsed.mercadoLivreLinks.length > 0 || parsed.amazonLinks.length > 0;
    // "Trocar link automaticamente" é só uma preferência de conversão — a fonte da
    // verdade sobre a loja estar liberada pra disparo é a integração conectada
    // (affiliate_integrations.status). Sem essa checagem, uma conta sem Shopee/ML
    // conectado ainda despachava o link original normalmente.
    const requiredProviders: Array<"shopee" | "mercado_livre" | "amazon"> = [];
    if (parsed.shopeeLinks.length > 0) requiredProviders.push("shopee");
    if (parsed.mercadoLivreLinks.length > 0) requiredProviders.push("mercado_livre");
    if (parsed.amazonLinks.length > 0) requiredProviders.push("amazon");
    let disconnectedProvider: "shopee" | "mercado_livre" | "amazon" | null = null;
    if (requiredProviders.length > 0) {
      const { data: integrations, error: integrationsError } = await this.database
        .from("affiliate_integrations").select("provider,status,affiliate_tag")
        .eq("account_id", automation.account_id).in("provider", requiredProviders);
      if (integrationsError) throw integrationsError;
      const connectedProviders = new Set((integrations || [])
        .filter((row) => row.status === "connected" && (row.provider !== "amazon" || Boolean(row.affiliate_tag)))
        .map((row) => row.provider));
      disconnectedProvider = requiredProviders.find((provider) => !connectedProviders.has(provider)) ?? null;
    }
    const unsafeUnconvertedMercadoLivreLink = parsed.mercadoLivreLinks.some((value) => {
      try { return new URL(value).hostname.toLowerCase() === "meli.la"; } catch { return false; }
    }) && !automation.mercado_livre_conversion_enabled;
    const conversionRequired = shopeeConversionRequired || mercadoLivreConversionRequired || amazonConversionRequired;
    let offer = existingOffer;
    if (!offer) {
      const { data, error: insertError } = await this.database.from("captured_offers").insert({
        ...common,
        user_id: automation.created_by,
        source_type: message.sourceType,
        source_message_id: parsed.sourceMessageId,
        sender_id: parsed.senderId || null,
        original_text: parsed.text || null,
        processed_text: parsed.text || null,
        original_link: parsed.shopeeLinks[0] || parsed.links[0] || null,
        links: parsed.links,
        shopee_links: parsed.shopeeLinks,
        mercado_livre_links: parsed.mercadoLivreLinks,
        amazon_links: parsed.amazonLinks,
        affiliate_provider: parsed.affiliateLinks.length > 1 ? "multiple" : parsed.affiliateLinks[0]?.provider || null,
        content_hash: parsed.contentHash,
        affiliate_conversion_status: parsed.affiliateLinks.length === 0 ? "not_required" : conversionRequired ? "pending" : "not_enabled",
        ai_rewrite_status: automation.ai_rewrite_enabled ? "pending" : "not_enabled",
        status: "processing",
        ...this.processingLease(),
        captured_at: parsed.capturedAt.toISOString()
      }).select("*").single();
      if (insertError) {
        if (insertError.code === "23505") return null;
        throw insertError;
      }
      offer = data;
      log("offer_captured", { ...common, offer_id: offer.id });
    } else {
      log("offer_processing_resumed", { ...common, offer_id: offer.id, processing_attempts: offer.processing_attempts });
    }
    if (!hasSupportedMarketplaceLink || unsupportedLinks.length > 0 || disconnectedProvider) {
      const providerLabel = disconnectedProvider === "shopee" ? "Shopee" : disconnectedProvider === "mercado_livre" ? "Mercado Livre" : "Amazon";
      const message = !hasSupportedMarketplaceLink
          ? "A oferta não possui link de marketplace suportado; oferta ignorada."
          : disconnectedProvider
            ? `${providerLabel} não está conectado nesta conta; oferta ignorada.`
            : "A oferta contém link não permitido; oferta ignorada.";
      const errorCode = disconnectedProvider === "shopee"
          ? "SHOPEE_NOT_CONNECTED"
          : disconnectedProvider === "mercado_livre"
            ? "MERCADO_LIVRE_NOT_CONNECTED"
            : disconnectedProvider === "amazon"
              ? "AMAZON_NOT_CONNECTED"
            : "UNSUPPORTED_MARKETPLACE_LINK";
      await this.database.from("captured_offers").update({
        status: "ignored", error_code: errorCode, error_message: message,
        processed_at: new Date().toISOString(), processing_worker_id: null,
        processing_deadline_at: null, updated_at: new Date().toISOString()
      }).eq("id", offer.id).eq("account_id", automation.account_id)
        .eq("status", "processing").eq("processing_worker_id", env.INSTANCE_ID);
      log("offer_ignored_unsupported_marketplace", { ...common, offer_id: offer.id, unsupported_link_count: unsupportedLinks.length, disconnected_provider: disconnectedProvider });
      return { ...offer, status: "ignored" };
    }
    if (unsafeUnconvertedMercadoLivreLink) {
      const message = "Link curto do Mercado Livre bloqueado porque a conversão afiliada não está ativada.";
      await this.database.from("captured_offers").update({
        status: "processing_failed", affiliate_conversion_status: "failed",
        affiliate_conversion_error: message, error_code: "MERCADO_LIVRE_CONVERSION_REQUIRED",
        error_message: message, processed_at: new Date().toISOString(), processing_worker_id: null,
        processing_deadline_at: null, updated_at: new Date().toISOString()
      }).eq("id", offer.id).eq("account_id", automation.account_id)
        .eq("status", "processing").eq("processing_worker_id", env.INSTANCE_ID);
      log("offer_blocked_unconverted_mercado_livre_link", { ...common, offer_id: offer.id });
      return { ...offer, status: "processing_failed" };
    }

    try {
      if (!parsed.media && message.mediaLoader) {
        try {
          parsed.media = await message.mediaLoader();
        } catch (mediaError) {
          // A sessão do WhatsApp pode entregar a legenda corretamente mesmo
          // quando a chave da mídia expirou ou chegou fora de sincronia. Nesse
          // caso, preserve a oferta de texto em vez de bloquear todo o Piloto.
          console.warn({
            event: "offer_media_download_fallback",
            component: "offer-autopilot",
            ...common,
            offer_id: offer.id,
            error_kind: mediaError instanceof Error ? mediaError.name : "unknown"
          });
        }
      }
      let mediaFields: Record<string, string | null> = offer.media_bucket && offer.media_path
        ? { media_bucket: offer.media_bucket, media_path: offer.media_path, media_mime_type: offer.media_mime_type }
        : {};
      if (automation.keep_original_media && parsed.media && !offer.media_path) {
        const path = `${automation.account_id}/${automation.id}/${offer.id}.${parsed.media.extension}`;
        const { error } = await this.database.storage.from("offer-media").upload(path, parsed.media.buffer, {
          contentType: parsed.media.mimeType, upsert: false
        });
        if (error) throw error;
        mediaFields = { media_bucket: "offer-media", media_path: path, media_mime_type: parsed.media.mimeType };
        await this.database.from("captured_offers").update(mediaFields).eq("id", offer.id).eq("account_id", automation.account_id)
          .eq("status", "processing").eq("processing_worker_id", env.INSTANCE_ID);
      }
      let processedText = parsed.text;
      let linkUsed = parsed.shopeeLinks[0] || parsed.links[0] || null;
      if (await this.stopIfDisabled(automation, offer.id)) return { ...offer, status: "ignored" };
      if (shopeeConversionRequired) {
        try {
          if (!offerFeatureFlags.shopeeLinkConversion) throw new Error("Conversão Shopee desativada no ambiente.");
          await this.database.from("captured_offers").update({ affiliate_conversion_status: "resolving", affiliate_conversion_attempts: 1 })
            .eq("id", offer.id).eq("account_id", automation.account_id)
            .eq("status", "processing").eq("processing_worker_id", env.INSTANCE_ID);
          const conversion = await new ShopeeOfferConverter(this.database).convert(parsed, {
            accountId: automation.account_id, automationId: automation.id, offerId: offer.id, sourceGroupId: parsed.sourceGroupId
          }, processedText);
          if (!conversion.converted || !conversion.affiliateLink) throw new Error("O link encontrado não pôde ser associado com segurança a um produto Shopee.");
          processedText = conversion.processedText;
          linkUsed = conversion.affiliateLink;
          await this.database.from("captured_offers").update({
            processed_text: processedText, original_link: conversion.originalLink || linkUsed,
            resolved_url: conversion.resolvedUrl || null, shop_id: conversion.shopId || null, item_id: conversion.itemId || null,
            affiliate_link: conversion.affiliateLink, affiliate_conversion_status: "converted",
            affiliate_conversion_error: null, affiliate_converted_at: new Date().toISOString()
          }).eq("id", offer.id).eq("account_id", automation.account_id)
            .eq("status", "processing").eq("processing_worker_id", env.INSTANCE_ID);
          if (await this.stopIfDisabled(automation, offer.id)) return { ...offer, status: "ignored" };
        } catch (conversionError) {
          if (await this.stopIfDisabled(automation, offer.id)) return { ...offer, status: "ignored" };
          const conversionMessage = conversionError instanceof Error ? conversionError.message : "Falha na conversão Shopee.";
          await this.database.from("captured_offers").update({
            affiliate_conversion_status: "failed", affiliate_conversion_error: conversionMessage,
            error_code: "SHOPEE_CONVERSION_FAILED", error_message: conversionMessage, processed_at: new Date().toISOString()
          }).eq("id", offer.id).eq("account_id", automation.account_id)
            .eq("status", "processing").eq("processing_worker_id", env.INSTANCE_ID);
          console.error({ event: "shopee_affiliate_failed", component: "shopee-affiliate", ...common, offer_id: offer.id, error_kind: conversionError instanceof Error ? conversionError.name : "unknown" });
          if (automation.conversion_failure_policy !== "send_original") {
            await this.database.from("captured_offers").update({
              status: "processing_failed", processing_worker_id: null, processing_deadline_at: null, updated_at: new Date().toISOString()
            }).eq("id", offer.id).eq("account_id", automation.account_id)
              .eq("status", "processing").eq("processing_worker_id", env.INSTANCE_ID);
            return { ...offer, status: "processing_failed" };
          }
        }
      }
      if (mercadoLivreConversionRequired) {
        if (await this.stopIfDisabled(automation, offer.id)) return { ...offer, status: "ignored" };
        try {
          if (!offerFeatureFlags.mercadoLivreLinkConversion) throw new Error("Conversão Mercado Livre desativada no ambiente.");
          await this.database.from("captured_offers").update({ affiliate_conversion_status: "resolving", affiliate_conversion_attempts: 1 })
            .eq("id", offer.id).eq("account_id", automation.account_id)
            .eq("status", "processing").eq("processing_worker_id", env.INSTANCE_ID);
          const conversion = await new MercadoLivreOfferConverter(this.database).convert(parsed, {
            accountId: automation.account_id, automationId: automation.id, offerId: offer.id, sourceGroupId: parsed.sourceGroupId
          }, processedText);
          if (!conversion.converted || !conversion.affiliateLink) throw new Error("O link encontrado não pôde ser associado com segurança a um produto Mercado Livre.");
          processedText = conversion.processedText;
          linkUsed = conversion.affiliateLink;
          await this.database.from("captured_offers").update({
            processed_text: processedText, original_link: conversion.originalLink || linkUsed,
            resolved_url: conversion.resolvedUrl || null, item_id: conversion.itemId || conversion.catalogProductId || null,
            catalog_product_id: conversion.catalogProductId || null, affiliate_link: conversion.affiliateLink,
            affiliate_tag: conversion.affiliateTag || null, affiliate_conversion_status: "converted",
            affiliate_conversion_error: null, affiliate_converted_at: new Date().toISOString()
          }).eq("id", offer.id).eq("account_id", automation.account_id)
            .eq("status", "processing").eq("processing_worker_id", env.INSTANCE_ID);
          if (await this.stopIfDisabled(automation, offer.id)) return { ...offer, status: "ignored" };
        } catch (conversionError) {
          if (await this.stopIfDisabled(automation, offer.id)) return { ...offer, status: "ignored" };
          const conversionMessage = conversionError instanceof Error ? conversionError.message : "Falha na conversão Mercado Livre.";
          await this.database.from("captured_offers").update({
            affiliate_conversion_status: "failed", affiliate_conversion_error: conversionMessage,
            error_code: "MERCADO_LIVRE_CONVERSION_FAILED", error_message: conversionMessage, processed_at: new Date().toISOString()
          }).eq("id", offer.id).eq("account_id", automation.account_id)
            .eq("status", "processing").eq("processing_worker_id", env.INSTANCE_ID);
          console.error({ event: "mercado_livre_affiliate_failed", component: "mercado-livre-affiliate", ...common, offer_id: offer.id, error_kind: conversionError instanceof Error ? conversionError.name : "unknown" });
          if (automation.conversion_failure_policy !== "send_original") {
            await this.database.from("captured_offers").update({
              status: "processing_failed", processing_worker_id: null, processing_deadline_at: null, updated_at: new Date().toISOString()
            }).eq("id", offer.id).eq("account_id", automation.account_id)
              .eq("status", "processing").eq("processing_worker_id", env.INSTANCE_ID);
            return { ...offer, status: "processing_failed" };
          }
        }
      }
      if (amazonConversionRequired) {
        if (await this.stopIfDisabled(automation, offer.id)) return { ...offer, status: "ignored" };
        try {
          await this.database.from("captured_offers").update({ affiliate_conversion_status: "resolving", affiliate_conversion_attempts: 1 })
            .eq("id", offer.id).eq("account_id", automation.account_id)
            .eq("status", "processing").eq("processing_worker_id", env.INSTANCE_ID);
          const conversion = await this.amazonConverter.convert(parsed, {
            accountId: automation.account_id, automationId: automation.id, offerId: offer.id, sourceGroupId: parsed.sourceGroupId
          }, processedText);
          if (!conversion.converted || !conversion.affiliateLink) throw new Error("Todos os links Amazon devem ser convertidos antes do envio.");
          processedText = conversion.processedText;
          linkUsed = conversion.affiliateLink;
          await this.database.from("captured_offers").update({
            processed_text: processedText, original_link: conversion.originalLink || linkUsed,
            resolved_url: conversion.resolvedUrl || null, affiliate_link: conversion.affiliateLink,
            affiliate_tag: conversion.affiliateTag || null, affiliate_conversion_status: "converted",
            affiliate_conversion_error: null, affiliate_converted_at: new Date().toISOString()
          }).eq("id", offer.id).eq("account_id", automation.account_id)
            .eq("status", "processing").eq("processing_worker_id", env.INSTANCE_ID);
          if (await this.stopIfDisabled(automation, offer.id)) return { ...offer, status: "ignored" };
        } catch (conversionError) {
          const conversionMessage = conversionError instanceof Error ? conversionError.message : "Falha na conversão Amazon.";
          await this.database.from("captured_offers").update({
            status: "processing_failed", affiliate_conversion_status: "failed",
            affiliate_conversion_error: conversionMessage, error_code: "AMAZON_LINK_CONVERSION_FAILED",
            error_message: conversionMessage, processed_at: new Date().toISOString(),
            processing_worker_id: null, processing_deadline_at: null, updated_at: new Date().toISOString()
          }).eq("id", offer.id).eq("account_id", automation.account_id)
            .eq("status", "processing").eq("processing_worker_id", env.INSTANCE_ID);
          return { ...offer, status: "processing_failed", error_code: "AMAZON_LINK_CONVERSION_FAILED" };
        }
      }
      if (automation.ai_rewrite_enabled) {
        if (await this.stopIfDisabled(automation, offer.id)) return { ...offer, status: "ignored" };
        processedText = sanitizeSourcePromotion(processedText, linkUsed);
        try {
          if (!offerFeatureFlags.aiRewrite) throw new Error("Reescrita com IA desativada no ambiente.");
          const rewritten = await new OfferAiRewriter().rewrite({
            text: processedText,
            purchaseLink: linkUsed,
            links: parsed.links
          });
          processedText = rewritten.text;
          await this.database.from("captured_offers").update({
            processed_text: processedText,
            ai_rewrite_status: "rewritten",
            ai_rewrite_attempts: 1,
            ai_rewrite_model: rewritten.model,
            ai_rewrite_error: null,
            ai_rewritten_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          }).eq("id", offer.id).eq("account_id", automation.account_id)
            .eq("status", "processing").eq("processing_worker_id", env.INSTANCE_ID);
          log("offer_ai_rewritten", { ...common, offer_id: offer.id, model: rewritten.model });
        } catch (rewriteError) {
          const rewriteMessage = rewriteError instanceof Error ? rewriteError.message : "Falha na reescrita com IA.";
          await this.database.from("captured_offers").update({
            processed_text: processedText,
            ai_rewrite_status: "fallback",
            ai_rewrite_attempts: 1,
            ai_rewrite_error: rewriteMessage,
            updated_at: new Date().toISOString()
          }).eq("id", offer.id).eq("account_id", automation.account_id)
            .eq("status", "processing").eq("processing_worker_id", env.INSTANCE_ID);
          console.error({ event: "offer_ai_rewrite_fallback", component: "offer-autopilot", ...common, offer_id: offer.id, error_kind: rewriteError instanceof Error ? rewriteError.name : "unknown" });
        }
      }
      if (await this.stopIfDisabled(automation, offer.id)) return { ...offer, status: "ignored" };
      const { error: persistError } = await this.database.from("captured_offers").update({
        ...mediaFields, processed_text: processedText, processed_at: new Date().toISOString(), updated_at: new Date().toISOString()
      }).eq("id", offer.id).eq("account_id", automation.account_id).eq("status", "processing")
        .eq("processing_worker_id", env.INSTANCE_ID);
      if (persistError) throw persistError;

      const { data: scheduling, error: schedulingError } = await this.database.rpc("schedule_pilot_offer", {
        p_offer_id: offer.id,
        p_worker_id: env.INSTANCE_ID,
        p_now: new Date().toISOString()
      });
      if (schedulingError) throw schedulingError;
      const result = scheduling as { status: string; scheduled_at?: string; destinations?: number } | null;
      if (!result) throw new Error("O banco não retornou o agendamento da oferta.");
      if (result.status === "ready") {
        log("offer_ready", { ...common, offer_id: offer.id, destinations: 0 });
        return { ...offer, status: "ready" };
      }
      if (result.status === "ignored") return { ...offer, status: "ignored" };
      if (result.status === "waiting") {
        log("offer_waiting", { ...common, offer_id: offer.id });
        return { ...offer, status: "waiting", scheduled_at: undefined };
      }
      log("offer_scheduled", { ...common, offer_id: offer.id, scheduled_at: result.scheduled_at, destinations: result.destinations });
      return { ...offer, status: result.status, scheduled_at: result.scheduled_at };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Falha ao processar oferta.";
      await this.database.from("captured_offers").update({
        status: "processing_failed", error_code: "PROCESSING_FAILED", error_message: message,
        processed_at: new Date().toISOString(), processing_worker_id: null,
        processing_deadline_at: null, updated_at: new Date().toISOString()
      })
        .eq("id", offer.id).eq("account_id", automation.account_id).eq("status", "processing")
        .eq("processing_worker_id", env.INSTANCE_ID)
        .gt("processing_deadline_at", new Date().toISOString());
      console.error({ event: "offer_processing_failed", component: "offer-autopilot", ...common, offer_id: offer.id, error: message });
      return { ...offer, status: "processing_failed" };
    }
  }
}

export function offerMessageIdFallback() { return randomUUID(); }
