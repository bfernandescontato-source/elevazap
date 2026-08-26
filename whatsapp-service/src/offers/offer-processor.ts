import type { SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "crypto";
import { parseOffer } from "./offer-parser.js";
import { nextOfferSlot } from "./offer-scheduler.js";
import type { RawOfferMessage } from "./types.js";
import { ShopeeOfferConverter } from "./shopee-conversion.js";
import { offerFeatureFlags } from "./feature-flags.js";
import { OfferAiRewriter, sanitizeSourcePromotion } from "./offer-ai-rewriter.js";
import { MercadoLivreOfferConverter } from "./mercado-livre-conversion.js";

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
  constructor(private database: SupabaseClient) {}

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
      processed_at: new Date().toISOString(), updated_at: new Date().toISOString()
    }).eq("id", offerId).eq("account_id", automation.account_id);
    log("offer_cancelled_pilot_disabled", { account_id: automation.account_id, automation_id: automation.id, offer_id: offerId });
    return true;
  }

  async process(automation: Automation, message: RawOfferMessage) {
    if (!(await this.automationEnabled(automation))) return null;
    const parsed = parseOffer(message);
    if (!parsed.text && !parsed.media) return null;
    const common = { account_id: automation.account_id, automation_id: automation.id, source_group_id: parsed.sourceGroupId };
    log("offer_parsed", { ...common, source_message_id: parsed.sourceMessageId, link_count: parsed.links.length });

    const shopeeConversionRequired = parsed.shopeeLinks.length > 0 && automation.shopee_conversion_enabled;
    const mercadoLivreConversionRequired = parsed.mercadoLivreLinks.length > 0 && automation.mercado_livre_conversion_enabled;
    const unsafeUnconvertedMercadoLivreLink = parsed.mercadoLivreLinks.some((value) => {
      try { return new URL(value).hostname.toLowerCase() === "meli.la"; } catch { return false; }
    }) && !automation.mercado_livre_conversion_enabled;
    const conversionRequired = shopeeConversionRequired || mercadoLivreConversionRequired;
    const { data: offer, error: insertError } = await this.database.from("captured_offers").insert({
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
      affiliate_provider: parsed.affiliateLinks.length > 1 ? "multiple" : parsed.affiliateLinks[0]?.provider || null,
      content_hash: parsed.contentHash,
      affiliate_conversion_status: parsed.affiliateLinks.length === 0 ? "not_required" : conversionRequired ? "pending" : "not_enabled",
      ai_rewrite_status: automation.ai_rewrite_enabled ? "pending" : "not_enabled",
      status: "processing",
      captured_at: parsed.capturedAt.toISOString()
    }).select("*").single();
    if (insertError) {
      if (insertError.code === "23505") return null;
      throw insertError;
    }
    log("offer_captured", { ...common, offer_id: offer.id });
    if (parsed.amazonLinks.length > 0) {
      const message = "Amazon ainda não integrado ao Piloto Automático; oferta ignorada.";
      await this.database.from("captured_offers").update({
        status: "ignored", error_code: "AMAZON_NOT_SUPPORTED_YET", error_message: message,
        processed_at: new Date().toISOString(), updated_at: new Date().toISOString()
      }).eq("id", offer.id).eq("account_id", automation.account_id);
      log("offer_ignored_amazon_not_supported", { ...common, offer_id: offer.id });
      return { ...offer, status: "ignored" };
    }
    if (unsafeUnconvertedMercadoLivreLink) {
      const message = "Link curto do Mercado Livre bloqueado porque a conversão afiliada não está ativada.";
      await this.database.from("captured_offers").update({
        status: "processing_failed", affiliate_conversion_status: "failed",
        affiliate_conversion_error: message, error_code: "MERCADO_LIVRE_CONVERSION_REQUIRED",
        error_message: message, processed_at: new Date().toISOString(), updated_at: new Date().toISOString()
      }).eq("id", offer.id).eq("account_id", automation.account_id);
      log("offer_blocked_unconverted_mercado_livre_link", { ...common, offer_id: offer.id });
      return { ...offer, status: "processing_failed" };
    }

    try {
      let mediaFields: Record<string, string | null> = {};
      if (automation.keep_original_media && parsed.media) {
        const path = `${automation.account_id}/${automation.id}/${offer.id}.${parsed.media.extension}`;
        const { error } = await this.database.storage.from("offer-media").upload(path, parsed.media.buffer, {
          contentType: parsed.media.mimeType, upsert: false
        });
        if (error) throw error;
        mediaFields = { media_bucket: "offer-media", media_path: path, media_mime_type: parsed.media.mimeType };
        await this.database.from("captured_offers").update(mediaFields).eq("id", offer.id).eq("account_id", automation.account_id);
      }
      let processedText = parsed.text;
      let linkUsed = parsed.shopeeLinks[0] || parsed.links[0] || null;
      if (await this.stopIfDisabled(automation, offer.id)) return { ...offer, status: "ignored" };
      if (shopeeConversionRequired) {
        try {
          if (!offerFeatureFlags.shopeeLinkConversion) throw new Error("Conversão Shopee desativada no ambiente.");
          await this.database.from("captured_offers").update({ affiliate_conversion_status: "resolving", affiliate_conversion_attempts: 1 })
            .eq("id", offer.id).eq("account_id", automation.account_id);
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
          }).eq("id", offer.id).eq("account_id", automation.account_id);
          if (await this.stopIfDisabled(automation, offer.id)) return { ...offer, status: "ignored" };
        } catch (conversionError) {
          if (await this.stopIfDisabled(automation, offer.id)) return { ...offer, status: "ignored" };
          const conversionMessage = conversionError instanceof Error ? conversionError.message : "Falha na conversão Shopee.";
          await this.database.from("captured_offers").update({
            affiliate_conversion_status: "failed", affiliate_conversion_error: conversionMessage,
            error_code: "SHOPEE_CONVERSION_FAILED", error_message: conversionMessage, processed_at: new Date().toISOString()
          }).eq("id", offer.id).eq("account_id", automation.account_id);
          console.error({ event: "shopee_affiliate_failed", component: "shopee-affiliate", ...common, offer_id: offer.id, error_kind: conversionError instanceof Error ? conversionError.name : "unknown" });
          if (automation.conversion_failure_policy !== "send_original") {
            await this.database.from("captured_offers").update({ status: "processing_failed" }).eq("id", offer.id).eq("account_id", automation.account_id);
            return { ...offer, status: "processing_failed" };
          }
        }
      }
      if (mercadoLivreConversionRequired) {
        if (await this.stopIfDisabled(automation, offer.id)) return { ...offer, status: "ignored" };
        try {
          if (!offerFeatureFlags.mercadoLivreLinkConversion) throw new Error("Conversão Mercado Livre desativada no ambiente.");
          await this.database.from("captured_offers").update({ affiliate_conversion_status: "resolving", affiliate_conversion_attempts: 1 })
            .eq("id", offer.id).eq("account_id", automation.account_id);
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
          }).eq("id", offer.id).eq("account_id", automation.account_id);
          if (await this.stopIfDisabled(automation, offer.id)) return { ...offer, status: "ignored" };
        } catch (conversionError) {
          if (await this.stopIfDisabled(automation, offer.id)) return { ...offer, status: "ignored" };
          const conversionMessage = conversionError instanceof Error ? conversionError.message : "Falha na conversão Mercado Livre.";
          await this.database.from("captured_offers").update({
            affiliate_conversion_status: "failed", affiliate_conversion_error: conversionMessage,
            error_code: "MERCADO_LIVRE_CONVERSION_FAILED", error_message: conversionMessage, processed_at: new Date().toISOString()
          }).eq("id", offer.id).eq("account_id", automation.account_id);
          console.error({ event: "mercado_livre_affiliate_failed", component: "mercado-livre-affiliate", ...common, offer_id: offer.id, error_kind: conversionError instanceof Error ? conversionError.name : "unknown" });
          if (automation.conversion_failure_policy !== "send_original") {
            await this.database.from("captured_offers").update({ status: "processing_failed" }).eq("id", offer.id).eq("account_id", automation.account_id);
            return { ...offer, status: "processing_failed" };
          }
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
          }).eq("id", offer.id).eq("account_id", automation.account_id);
          log("offer_ai_rewritten", { ...common, offer_id: offer.id, model: rewritten.model });
        } catch (rewriteError) {
          const rewriteMessage = rewriteError instanceof Error ? rewriteError.message : "Falha na reescrita com IA.";
          await this.database.from("captured_offers").update({
            processed_text: processedText,
            ai_rewrite_status: "fallback",
            ai_rewrite_attempts: 1,
            ai_rewrite_error: rewriteMessage,
            updated_at: new Date().toISOString()
          }).eq("id", offer.id).eq("account_id", automation.account_id);
          console.error({ event: "offer_ai_rewrite_fallback", component: "offer-autopilot", ...common, offer_id: offer.id, error_kind: rewriteError instanceof Error ? rewriteError.name : "unknown" });
        }
      }
      const { data: destinations, error: destinationsError } = await this.database.from("automation_destinations")
        .select("whatsapp_group_id,grupos(nome)").eq("account_id", automation.account_id)
        .eq("automation_id", automation.id).eq("enabled", true);
      if (destinationsError) throw destinationsError;
      if (await this.stopIfDisabled(automation, offer.id)) return { ...offer, status: "ignored" };
      if (!destinations?.length) {
        await this.database.from("captured_offers").update({ ...mediaFields, status: "ready", processed_at: new Date().toISOString() })
          .eq("id", offer.id).eq("account_id", automation.account_id);
        log("offer_ready", { ...common, offer_id: offer.id, destinations: 0 });
        return offer;
      }

      const now = new Date();
      const { data: reservedSlot, error: reserveError } = await this.database.rpc("reserve_offer_schedule_slot", {
        p_automation_id: automation.id,
        p_now: now.toISOString()
      });
      const reserveRpcMissing = reserveError && ["PGRST202", "42883"].includes(reserveError.code || "");
      if (reserveError && !reserveRpcMissing) throw reserveError;
      let scheduledAt: Date;
      if (reservedSlot) {
        scheduledAt = new Date(reservedSlot);
      } else {
        // Compatibility fallback while an environment applies the migration.
        const { data: latest } = await this.database.from("captured_offers").select("scheduled_at")
          .eq("account_id", automation.account_id).eq("automation_id", automation.id)
          .in("status", ["scheduled", "sending", "sent"]).not("scheduled_at", "is", null)
          .order("scheduled_at", { ascending: false }).limit(1).maybeSingle();
        scheduledAt = nextOfferSlot({
          intervalMinutes: automation.interval_minutes,
          operatingStart: automation.operating_start,
          operatingEnd: automation.operating_end,
          timezone: automation.timezone
        }, now, latest?.scheduled_at ? new Date(latest.scheduled_at) : null);
      }
      const senderRelation = Array.isArray(automation.whatsapp_senders) ? automation.whatsapp_senders[0] : automation.whatsapp_senders;
      if (!senderRelation?.session_name) throw new Error("Número responsável não encontrado.");
      const type = parsed.media && automation.keep_original_media ? "imagem" : "texto";
      const text = automation.keep_original_text ? processedText : "";

      if (await this.stopIfDisabled(automation, offer.id)) return { ...offer, status: "ignored" };

      const { data: lote, error: loteError } = await this.database.from("envios_grupo_lotes").insert({
        account_id: automation.account_id,
        titulo: `Piloto Automático · ${parsed.text.slice(0, 70) || "Oferta"}`,
        whatsapp_sender_id: automation.whatsapp_sender_id,
        whatsapp_session_name: senderRelation.session_name,
        tipo: type,
        texto: type === "texto" ? text : null,
        legenda: type === "imagem" ? text : null,
        media_bucket: mediaFields.media_bucket || null,
        media_path: mediaFields.media_path || null,
        mime_type: mediaFields.media_mime_type || null,
        file_name: type === "imagem" ? `oferta-${offer.id}.jpg` : null,
        status: "pendente",
        total: destinations.length,
        pendentes: destinations.length,
        scheduled_at: scheduledAt.toISOString()
      }).select("id").single();
      if (loteError) throw loteError;
      if (await this.stopIfDisabled(automation, offer.id)) {
        await this.database.from("envios_grupo_lotes").update({ status: "cancelado", pendentes: 0, cancelados: destinations.length, updated_at: new Date().toISOString() })
          .eq("id", lote.id).eq("account_id", automation.account_id);
        return { ...offer, status: "ignored" };
      }

      const dispatchRows = destinations.map((destination) => ({
        account_id: automation.account_id,
        lote_id: lote.id,
        whatsapp_sender_id: automation.whatsapp_sender_id,
        whatsapp_session_name: senderRelation.session_name,
        group_jid: destination.whatsapp_group_id,
        nome_grupo: Array.isArray(destination.grupos) ? destination.grupos[0]?.nome : (destination.grupos as { nome?: string } | null)?.nome,
        tipo: type,
        texto: type === "texto" ? text : null,
        legenda: type === "imagem" ? text : null,
        media_bucket: mediaFields.media_bucket || null,
        media_path: mediaFields.media_path || null,
        mime_type: mediaFields.media_mime_type || null,
        file_name: type === "imagem" ? `oferta-${offer.id}.jpg` : null,
        status: "pendente",
        scheduled_at: scheduledAt.toISOString()
      }));
      const { data: dispatches, error: dispatchError } = await this.database.from("envios_grupo").insert(dispatchRows).select("id,group_jid");
      if (dispatchError) throw dispatchError;
      const byGroup = new Map((dispatches || []).map((item) => [item.group_jid, item.id]));
      const { error: deliveryError } = await this.database.from("offer_deliveries").insert(destinations.map((destination) => ({
        account_id: automation.account_id,
        offer_id: offer.id,
        destination_group_id: destination.whatsapp_group_id,
        group_dispatch_id: byGroup.get(destination.whatsapp_group_id),
        link_used: linkUsed,
        status: "scheduled",
        scheduled_at: scheduledAt.toISOString()
      })));
      if (deliveryError) throw deliveryError;
      const processedAt = new Date().toISOString();
      await this.database.from("captured_offers").update({ ...mediaFields, processed_text: processedText, status: "scheduled", processed_at: processedAt, scheduled_at: scheduledAt.toISOString() })
        .eq("id", offer.id).eq("account_id", automation.account_id);
      log("offer_scheduled", { ...common, offer_id: offer.id, scheduled_at: scheduledAt.toISOString(), destinations: destinations.length });
      return { ...offer, status: "scheduled", scheduled_at: scheduledAt.toISOString() };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Falha ao processar oferta.";
      await this.database.from("captured_offers").update({ status: "processing_failed", error_code: "PROCESSING_FAILED", error_message: message, processed_at: new Date().toISOString() })
        .eq("id", offer.id).eq("account_id", automation.account_id);
      console.error({ event: "offer_processing_failed", component: "offer-autopilot", ...common, offer_id: offer.id, error: message });
      return { ...offer, status: "processing_failed" };
    }
  }
}

export function offerMessageIdFallback() { return randomUUID(); }
