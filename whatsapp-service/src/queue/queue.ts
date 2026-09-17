import { env } from "../env.js";
import { supabase } from "../supabase.js";
import { downloadMedia, buildBaileysMessage, convertVoiceToOpus, sharedMediaCache } from "../utils/media.js";
import { phoneToWhatsAppJid, validateGroupJid } from "../utils/phone.js";
import { dbResult } from "../utils/db.js";
import { correlationId, errorFields } from "../utils/log.js";
import { OperationTimeoutError, withTimeout } from "../utils/timeout.js";
import { getSenderSock, getSenderSockById } from "../senders/runtime.js";
import { compatibleQueueUpdate, type DatabaseCapabilities } from "../database-capabilities.js";
import { QueueMetrics } from "./metrics.js";
import { isMissingRpc, queueSleep, randomDelay, retryDelay } from "./policy.js";
import type { QueueItem, QueueReconciliation, QueueTableName } from "./types.js";
import { amazonMessageIsSafe } from "./amazon-safety.js";
import { normalizeWhatsappOfferText } from "../offers/whatsapp-copy.js";
import { getUrlInfo, prepareWAMessageMedia, type WAUrlInfo } from "@whiskeysockets/baileys";
import axios from "axios";
import { createHash } from "crypto";
import { decryptIntegrationSecret } from "../utils/integration-crypto.js";
import { ShopeeUrlResolver, extractShopeeProductIdentifiers } from "../offers/shopee-url-resolver.js";
import { MercadoLivreUrlResolver, extractFeaturedSocialProduct } from "../offers/mercado-livre-url-resolver.js";
import { isAmazonUrl, resolveAmazonUrl } from "@disparei/affiliate-links/amazon";

const URL_IN_TEXT = /https?:\/\/[^\s<>"']+/i;

const OG_META_PATTERNS: Record<"title" | "description" | "image", RegExp[]> = {
  title: [
    /<meta[^>]+(?:property|name)=["']og:title["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']og:title["']/i,
    /<title[^>]*>([^<]+)<\/title>/i
  ],
  description: [
    /<meta[^>]+(?:property|name)=["']og:description["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']og:description["']/i,
    /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i
  ],
  image: [
    /<meta[^>]+(?:property|name)=["']og:image(?::secure_url)?["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']og:image(?::secure_url)?["']/i
  ]
};

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}

function extractOgMeta(html: string, field: "title" | "description" | "image"): string | undefined {
  for (const pattern of OG_META_PATTERNS[field]) {
    const match = html.match(pattern);
    if (match?.[1]) return decodeHtmlEntities(match[1].trim());
  }
  return undefined;
}

/**
 * The Amazon.com.br og:image tag is a generic brand logo, not the product
 * photo, so it must not be used as the preview image. The real photo lives
 * on the #landingImage element instead — same source every long-standing
 * Amazon price-tracker scraper reads, since it's server-rendered in the
 * initial HTML (unlike a JS-only gallery).
 */
function extractAmazonProductImage(html: string): string | undefined {
  const dynamicImageAttr = html.match(/id=["']landingImage["'][^>]*data-a-dynamic-image=["']([^"']+)["']/i)
    || html.match(/data-a-dynamic-image=["']([^"']+)["'][^>]*id=["']landingImage["']/i);
  if (dynamicImageAttr?.[1]) {
    try {
      const parsed = JSON.parse(decodeHtmlEntities(dynamicImageAttr[1]));
      const firstUrl = Object.keys(parsed)[0];
      if (firstUrl) return firstUrl;
    } catch {
      // falls through to the other attributes below
    }
  }
  const hiresAttr = html.match(/id=["']landingImage["'][^>]*data-old-hires=["']([^"']+)["']/i);
  if (hiresAttr?.[1]?.trim()) return decodeHtmlEntities(hiresAttr[1]);
  const srcAttr = html.match(/id=["']landingImage["'][^>]*src=["']([^"']+)["']/i);
  if (srcAttr?.[1]) return decodeHtmlEntities(srcAttr[1]);
  return undefined;
}

type OfferPreviewContext = {
  link: string;
  accountId: string;
  itemId?: string;
  resolvedUrl?: string;
};

export class GlobalSendQueue {
  private buffer: QueueItem[] = [];
  private running = false;
  private lastSendAtBySession = new Map<string, number>();
  private lastStaleCleanupAt = 0;
  private activeSessions = new Map<string, { count: number; kind: QueueItem["kind"] }>();
  private reconciliation = new Map<string, QueueReconciliation>();
  private metrics = new QueueMetrics();
  private shopeeUrlResolver = new ShopeeUrlResolver();
  private mercadoLivreUrlResolver = new MercadoLivreUrlResolver();

  constructor(private databaseCapabilities: DatabaseCapabilities) {}

  private updateFields(table: QueueTableName, values: Record<string, unknown>) {
    return compatibleQueueUpdate(this.databaseCapabilities, table, values);
  }

  stats() {
    return { ...this.metrics.snapshot(this.running, this.buffer, this.reconciliation.size, this.activeCount()), media_cache: sharedMediaCache.snapshot() };
  }

  start() {
    if (this.running) return;
    this.running = true;
    void this.loop();
  }

  stop() {
    this.running = false;
  }

  private async resetStaleItems() {
    if (Date.now() - this.lastStaleCleanupAt < 30_000) return;
    this.lastStaleCleanupAt = Date.now();
    const now = new Date().toISOString();
    for (const table of ["envios", "envios_grupo"] as const) {
      await supabase.from(table).update(this.updateFields(table, {
        status: "pendente",
        claim_token: null,
        processing_deadline_at: null,
        updated_at: now,
      }))
        .eq("status", "enfileirado")
        .not("processing_deadline_at", "is", null)
        .lt("processing_deadline_at", now);
    }
  }

  private async loop() {
    while (this.running) {
      try {
        await this.resetStaleItems();
        await this.flushReconciliation();
        const capacity = Math.max(0, env.SYSTEM_MAX_CONCURRENT_SENDS - this.activeCount() - this.buffer.length);
        if (capacity > 0) await this.claimBatch(Math.min(capacity, env.DISPATCH_BATCH_SIZE));
        this.dispatchBuffered();
        await queueSleep(this.buffer.length ? 25 : env.DISPATCH_POLL_MS);
      } catch (error) {
        this.metrics.loopError(error);
        console.error({ event: "queue.loop_failed", component: "queue", ...errorFields(error) });
        await queueSleep(3_000);
      }
    }
  }

  private async claimBatch(limit: number) {
    if (limit <= 0) return;
    const { data: control, error: controlError } = await supabase.from("queue_control")
      .select("dispatch_enabled,queue_reset_at").eq("key", "whatsapp_dispatch").maybeSingle();
    if (controlError) throw new Error(`queue.control: ${controlError.message}`);
    if (!control?.dispatch_enabled) return;
    const rows = await dbResult<any[]>("queue.claim.batch", supabase.rpc("claim_whatsapp_jobs", {
      p_worker_id: env.INSTANCE_ID,
      p_limit: limit,
      p_account_concurrency: env.ACCOUNT_MAX_CONCURRENT_SENDS,
      p_processing_seconds: Math.ceil(env.QUEUE_PROCESSING_TIMEOUT_MS / 1000)
    }));
    for (const row of rows || []) {
      if (!row?.message_id || !row?.whatsapp_session_id || !row?.claim_token) continue;
      this.metrics.claim();
      this.buffer.push({
        id: row.message_id,
        kind: row.queue_table === "envios" ? "envio" : "grupo",
        priority: row.priority === "alta" ? "alta" : "normal",
        claim_token: row.claim_token,
        account_id: row.account_id,
        whatsapp_session_id: row.whatsapp_session_id,
        lease_version: Number(row.lease_version),
        attempt: Number(row.attempt || 0)
      });
    }
  }

  private dispatchBuffered() {
    for (let index = 0; index < this.buffer.length && this.activeCount() < env.SYSTEM_MAX_CONCURRENT_SENDS;) {
      const item = this.buffer[index];
      const active = this.activeSessions.get(item.whatsapp_session_id);
      const sessionLimit = item.kind === "grupo" ? env.GROUP_BATCH_MAX_CONCURRENT_SENDS : 1;
      if (active && (active.kind !== item.kind || active.count >= sessionLimit)) { index += 1; continue; }
      this.buffer.splice(index, 1);
      this.activeSessions.set(item.whatsapp_session_id, { count: (active?.count || 0) + 1, kind: item.kind });
      void this.process(item).catch((error) => {
        this.metrics.loopError(error);
        console.error({ event: "queue.item_unhandled", component: "queue", account_id: item.account_id,
          session_id: item.whatsapp_session_id, message_id: correlationId(item.id), worker_id: env.INSTANCE_ID,
          lease_version: item.lease_version, attempt: item.attempt, ...errorFields(error) });
      }).finally(() => {
        const current = this.activeSessions.get(item.whatsapp_session_id);
        if (!current || current.count <= 1) this.activeSessions.delete(item.whatsapp_session_id);
        else this.activeSessions.set(item.whatsapp_session_id, { ...current, count: current.count - 1 });
      });
    }
  }

  private activeCount() {
    return Array.from(this.activeSessions.values()).reduce((total, active) => total + active.count, 0);
  }

  private async process(item: QueueItem) {
    const table: QueueTableName = item.kind === "envio" ? "envios" : "envios_grupo";
    const row = await dbResult<any>("queue.mark-processing", supabase.rpc("mark_whatsapp_job_sending", {
      p_worker_id: env.INSTANCE_ID,
      p_queue_table: table,
      p_message_id: item.id,
      p_claim_token: item.claim_token,
      p_lease_version: item.lease_version,
      p_processing_seconds: Math.ceil(env.QUEUE_PROCESSING_TIMEOUT_MS / 1000)
    }));
    if (!row) return;

    if (table === "envios_grupo" && await this.cancelIfPilotDisabled(row)) return;
    if (table === "envios_grupo" && await this.cancelIfAmazonUnavailable(row)) return;
    if (table === "envios_grupo") await this.syncOfferDelivery(row.id, "sending");

    try {
      const { data: account } = await supabase.from("accounts").select("status").eq("id", row.account_id).maybeSingle();
      if (account?.status !== "active") throw new Error("Assinatura inativa; envio bloqueado.");
      await withTimeout("queue.item", env.QUEUE_PROCESSING_TIMEOUT_MS, this.execute(item, row));
      this.metrics.success();
    } catch (error) {
      const potentiallyDelivered = error instanceof OperationTimeoutError &&
        ["queue.item", "whatsapp.sendMessage"].includes(error.operation);
      if (potentiallyDelivered) {
        await this.markUncertain(table, row, "O limite de tempo foi excedido durante o envio. Confirmação manual necessária.", "SEND_TIMEOUT");
        this.metrics.uncertainResult(error);
      } else {
        const leaseValid = await this.hasValidLease(item);
        if (!leaseValid) await this.markUncertain(table, row, "O worker perdeu o lease durante o envio. Confirmação manual necessária.", "FENCING_TOKEN_EXPIRED");
        else await this.markFailure(table, row, error instanceof Error ? error.message : "Falha no envio.", (error as any)?.code);
        this.metrics.failure(error);
      }
    }
  }

  private async cancelIfPilotDisabled(row: any) {
    const { data: delivery, error } = await supabase.from("offer_deliveries").select("offer_id")
      .eq("group_dispatch_id", row.id).maybeSingle();
    if (error) {
      if (["42P01", "PGRST205"].includes(error.code || "")) return false;
      throw error;
    }
    if (!delivery) return false;
    const { data: offer, error: offerError } = await supabase.from("captured_offers").select("automation_id")
      .eq("id", delivery.offer_id).eq("account_id", row.account_id).maybeSingle();
    if (offerError) throw offerError;
    if (!offer) return false;
    const { data: automation, error: automationError } = await supabase.from("offer_automations").select("enabled")
      .eq("id", offer.automation_id).eq("account_id", row.account_id).maybeSingle();
    if (automationError) throw automationError;
    if (automation?.enabled !== false) return false;
    await dbResult("queue.cancel-disabled-pilot", supabase.from("envios_grupo").update(this.updateFields("envios_grupo", {
      status: "cancelado", claim_token: null, processing_deadline_at: null,
      erro: "Piloto Automático desativado.", updated_at: new Date().toISOString()
    })).eq("id", row.id));
    await this.syncOfferDelivery(row.id, "cancelled", "Piloto Automático desativado.");
    await this.recalc(row.lote_id);
    return true;
  }

  private async cancelIfAmazonUnavailable(row: any) {
    const { data: delivery, error } = await supabase.from("offer_deliveries").select("offer_id")
      .eq("group_dispatch_id", row.id).maybeSingle();
    if (error) {
      if (["42P01", "PGRST205"].includes(error.code || "")) return false;
      throw error;
    }
    if (!delivery) return false;
    const { data: offer, error: offerError } = await supabase.from("captured_offers").select("amazon_links")
      .eq("id", delivery.offer_id).eq("account_id", row.account_id).maybeSingle();
    if (offerError) throw offerError;
    if (!Array.isArray(offer?.amazon_links) || offer.amazon_links.length === 0) return false;

    const { data: integration, error: integrationError } = await supabase.from("affiliate_integrations")
      .select("status,affiliate_tag").eq("account_id", row.account_id).eq("provider", "amazon").maybeSingle();
    if (integrationError) throw integrationError;
    const message = String(row.texto || row.legenda || "");
    const connected = integration?.status === "connected" && Boolean(integration.affiliate_tag);
    const safe = connected && amazonMessageIsSafe(message, integration.affiliate_tag);
    if (safe) return false;

    const reason = connected
      ? "Link Amazon não corresponde ao Partner Tag configurado; envio cancelado."
      : "Integração Amazon removida ou desativada; envio cancelado.";
    await dbResult("queue.cancel-unsafe-amazon", supabase.from("envios_grupo").update(this.updateFields("envios_grupo", {
      status: "cancelado", claim_token: null, processing_deadline_at: null,
      erro: reason, last_error_code: connected ? "AMAZON_LINK_CONVERSION_FAILED" : "AMAZON_NOT_CONNECTED",
      updated_at: new Date().toISOString()
    })).eq("id", row.id));
    await this.syncOfferDelivery(row.id, "cancelled", reason);
    await this.recalc(row.lote_id);
    return true;
  }

  private async execute(item: QueueItem, row: any) {
    const lastSendAt = this.lastSendAtBySession.get(item.whatsapp_session_id) || 0;
    const throttleWait = Math.max(0, env.GLOBAL_SEND_THROTTLE_MS - (Date.now() - lastSendAt));
    if (throttleWait) await queueSleep(throttleWait);
    if (item.kind === "envio" && row.source !== "massa_manual") await queueSleep(randomDelay(3_000, 8_000));
    if (item.kind === "envio") await this.sendWelcome(row);
    else await this.sendGroup(row);
    this.lastSendAtBySession.set(item.whatsapp_session_id, Date.now());
  }

  private async hasValidLease(item: QueueItem) {
    const valid = await dbResult<boolean>("queue.validate-lease", supabase.rpc("validate_whatsapp_session_lease", {
      p_worker_id: env.INSTANCE_ID,
      p_session_id: item.whatsapp_session_id,
      p_lease_version: item.lease_version
    }));
    return Boolean(valid);
  }

  private selectSocket(row: any, group = false) {
    if (!row.whatsapp_session_name && !row.whatsapp_sender_id) throw new Error("Envio sem número WhatsApp associado à conta.");
    const selected = (row.whatsapp_session_name ? getSenderSock(row.whatsapp_session_name, row.account_id) : null)
      || (row.whatsapp_sender_id ? getSenderSockById(row.whatsapp_sender_id, row.account_id) : null);
    if (!selected) throw new Error(group ? "Número responsável pelo grupo está desconectado." : "Número responsável pelo disparo está desconectado.");
    return selected;
  }

  private async sendWelcome(row: any) {
    const sock = this.selectSocket(row);
    if (!sock) throw new Error("Nenhum número conectado para disparo 1x1.");
    const optOuts = await dbResult<any[]>("queue.opt-out", supabase.from("opt_outs").select("id").eq("account_id", row.account_id).or(`telefone.eq.${row.telefone},email.eq.${row.email}`).limit(1));
    if (optOuts?.length) throw new Error("Contato em opt-out.");
    const jid = await this.resolveRecipientJid(sock, row);
    if (!jid) return;
    const result = await withTimeout<any>("whatsapp.sendMessage", env.SEND_TIMEOUT_MS, sock.sendMessage(jid, { text: row.mensagem_enviada }));
    await this.persistSuccess("envios", row, result?.key?.id || null);
  }

  private async resolveRecipientJid(sock: any, row: any): Promise<string | null> {
    const fallbackJid = phoneToWhatsAppJid(row.telefone);
    if (typeof sock.onWhatsApp !== "function") return fallbackJid;
    try {
      const result = await withTimeout<any[]>("whatsapp.lookup", env.SEND_TIMEOUT_MS, sock.onWhatsApp(fallbackJid.replace("@s.whatsapp.net", "")));
      const match = (result || []).find((entry: any) => entry?.exists && entry?.jid);
      if (match?.jid) return match.jid;
    } catch (error) {
      console.warn({ event: "queue.lookup_failed", component: "queue", jobId: correlationId(row.id), ...errorFields(error) });
      return fallbackJid;
    }
    await dbResult("queue.phone-not-found", supabase.from("envios").update(this.updateFields("envios", {
      status: "erro",
      erro: "Telefone não encontrado no WhatsApp.",
      attempts: (row.attempts || 0) + 1,
      claim_token: null,
      processing_deadline_at: null,
      last_attempt_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    })).eq("id", row.id));
    return null;
  }

  private async sendGroup(row: any) {
    if (!validateGroupJid(row.group_jid)) throw new Error("JID de grupo inválido.");
    const sock = this.selectSocket(row, true);
    let media: Buffer | undefined;
    if (row.media_bucket && row.media_path) {
      const sourceKey = `${row.media_bucket}:${row.media_path}`;
      const source = await sharedMediaCache.getOrLoad(sourceKey, () => downloadMedia(row.media_bucket, row.media_path));
      media = row.tipo === "audio_voz"
        ? await sharedMediaCache.getOrLoad(`${sourceKey}:opus`, () => convertVoiceToOpus(source))
        : source;
      console.info({ event: "media_cache_snapshot", component: "queue", lote_id: row.lote_id || null,
        media_id: sourceKey, media_size: media.byteLength, destinations_count: row.lote_id ? undefined : 1,
        ...sharedMediaCache.snapshot() });
    }
    const mentions = row.mention_all ? await this.getGroupMentions(sock, row.group_jid) : [];
    const offerPreview = row.tipo === "texto" ? await this.findOfferPreviewContext(row) : null;
    const linkPreview = offerPreview ? await this.generateOfferLinkPreview(row.texto || "", offerPreview, row.id, sock) : undefined;
    const message: any = buildBaileysMessage(row, media, mentions);
    if (offerPreview && "text" in message) message.text = normalizeWhatsappOfferText(message.text);
    if (linkPreview && "text" in message) message.linkPreview = linkPreview;
    const result = await withTimeout<any>(
      "whatsapp.sendMessage",
      env.SEND_TIMEOUT_MS,
      sock.sendMessage(row.group_jid, message)
    );
    if (offerPreview) {
      console.info({
        event: "offer_media_delivery",
        component: "queue",
        dispatch_id: correlationId(row.id),
        media_source: "product_link_preview",
        link_preview_generated: Boolean(result?.message?.extendedTextMessage?.jpegThumbnail || result?.message?.extendedTextMessage?.thumbnailDirectPath),
        preview_url: linkPreview?.["canonical-url"] || offerPreview.link
      });
    }
    await this.persistSuccess("envios_grupo", row, result?.key?.id || null);
  }

  /**
   * Only offer deliveries opt into pre-built previews. This keeps ordinary group
   * messages on the existing Baileys path and never changes queue scheduling.
   */
  private async findOfferPreviewContext(row: any): Promise<OfferPreviewContext | null> {
    const [{ data: pilotDelivery }, { data: catalogDelivery }] = await Promise.all([
      supabase.from("offer_deliveries").select("link_used,offer_id").eq("group_dispatch_id", row.id).maybeSingle(),
      supabase.from("affiliate_offer_deliveries").select("affiliate_url,external_item_id,provider").eq("group_dispatch_id", row.id).maybeSingle()
    ]);
    const link = String(pilotDelivery?.link_used || catalogDelivery?.affiliate_url || "").trim();
    if (!link) return null;
    if (pilotDelivery?.offer_id) {
      const { data: offer } = await supabase.from("captured_offers").select("item_id,resolved_url")
        .eq("id", pilotDelivery.offer_id).eq("account_id", row.account_id).maybeSingle();
      return { link, accountId: row.account_id, itemId: offer?.item_id || undefined, resolvedUrl: offer?.resolved_url || undefined };
    }
    return { link, accountId: row.account_id, itemId: catalogDelivery?.provider === "SHOPEE" ? catalogDelivery.external_item_id : undefined };
  }

  /**
   * Baileys refuses a preview when a short Shopee URL redirects to another host.
   * Resolve that URL ourselves for metadata, while retaining the original
   * affiliate URL as the visible/clickable text in WhatsApp.
   */
  private async generateOfferLinkPreview(text: string, context: OfferPreviewContext, dispatchId: string, sock: any): Promise<WAUrlInfo | undefined> {
    const matched = text.match(URL_IN_TEXT)?.[0] || context.link;
    if (!matched) return undefined;
    try {
      let metadataUrl = matched;
      const host = new URL(matched).hostname.toLowerCase();
      if (["shopee.com.br", "www.shopee.com.br", "s.shopee.com.br"].includes(host)) {
        metadataUrl = context.resolvedUrl || await this.shopeeUrlResolver.resolveUrl(matched);
        const itemId = context.itemId || extractShopeeProductIdentifiers(metadataUrl).itemId;
        if (itemId) {
          const product = await this.getShopeeProductPreview(context.accountId, itemId, dispatchId, sock);
          if (product) return { ...product, "matched-text": matched };
        }
      } else if (isAmazonUrl(matched)) {
        // Os grupos monitorados embrulham o link da Amazon em encurtadores de
        // terceiro (amzlink.me, amzlinks.in) que redirecionam pra um domínio
        // diferente (amazon.com.br) — o scraper genérico do Baileys se recusa
        // a seguir um redirecionamento assim por segurança própria dele, então
        // resolvemos pra URL final aqui antes de raspar a página.
        metadataUrl = context.resolvedUrl || await resolveAmazonUrl(matched);
      } else if (["meli.la", "mercadolivre.com.br", "www.mercadolivre.com.br", "produto.mercadolivre.com.br"].includes(host)) {
        // meli.la redireciona pra um domínio diferente (mercadolivre.com.br),
        // mesmo problema de redirect cross-domain do Amazon acima, e além
        // disso o Mercado Livre só devolve os componentes de página (inclusive
        // o produto de uma vitrine /social/) pra um user-agent de navegador —
        // por isso usa o mesmo resolvedor já usado na conversão de afiliado.
        try {
          metadataUrl = context.resolvedUrl || (await this.mercadoLivreUrlResolver.resolveUrl(matched)).resolvedUrl;
        } catch (resolveError) {
          console.warn({ event: "offer_link_preview_failed", component: "queue", dispatch_id: correlationId(dispatchId), preview_url: matched, reason: "mercado_livre_resolve_failed", ...errorFields(resolveError) });
        }
      }
      let info: WAUrlInfo | undefined;
      try {
        info = await getUrlInfo(metadataUrl, {
          thumbnailWidth: 720,
          fetchOpts: {
            timeout: 10_000,
            headers: { "user-agent": "Mozilla/5.0 (compatible; Disparei/1.0)" }
          },
          // Sem isso, o preview usa uma miniatura pequena comprimida localmente
          // em vez de subir a imagem cheia pros servidores do WhatsApp — é essa
          // etapa de upload que faz o card sair grande, igual a um link colado
          // manualmente (o socket já habilita generateHighQualityLinkPreview,
          // mas isso só vale pro auto-preview do Baileys; aqui montamos o
          // preview na mão, então precisamos ligar o upload nós mesmos).
          uploadImage: sock.waUploadToServer
        });
      } catch (getUrlInfoError) {
        // O getUrlInfo do Baileys tenta subir a imagem mesmo quando a página
        // não tem nenhuma (og:image ausente) e essa chamada não tem proteção
        // própria — um erro aí derruba a função inteira em vez de só deixar
        // sem imagem. Trata como "sem resultado" e deixa o fallback abaixo
        // (que já tem seu próprio tratamento de erro por imagem) tentar.
        console.warn({ event: "offer_link_preview_failed", component: "queue", dispatch_id: correlationId(dispatchId), preview_url: metadataUrl, reason: "get_url_info_threw", ...errorFields(getUrlInfoError) });
      }
      const hasImage = (candidate: WAUrlInfo | undefined) => !!(candidate?.jpegThumbnail || candidate?.highQualityThumbnail);
      // amazon.com.br's own og:image is a generic brand logo, not the product
      // photo, so an image found there by the generic scraper can't be
      // trusted — always re-check against the real product image for it.
      const imageIsUntrustworthy = isAmazonUrl(metadataUrl);
      if (!info?.title || !hasImage(info) || imageIsUntrustworthy) {
        // Amazon e Mercado Livre não têm uma API de produto própria como a da
        // Shopee aqui; o scraper genérico do Baileys às vezes não acha (ou é
        // bloqueado ao buscar) a og:image dessas páginas. Raspa a página nós
        // mesmos com cabeçalhos de navegador antes de desistir da imagem,
        // sem descartar o que o Baileys já tiver conseguido (título/descrição).
        const fallback = await this.scrapeOgImageAndMeta(metadataUrl, dispatchId, sock);
        if (fallback) {
          const preferFallbackImage = imageIsUntrustworthy ? hasImage(fallback) : !hasImage(info);
          info = {
            ...(info || {}),
            "canonical-url": info?.["canonical-url"] || fallback["canonical-url"],
            title: info?.title || fallback.title,
            description: info?.description || fallback.description,
            originalThumbnailUrl: preferFallbackImage ? fallback.originalThumbnailUrl : info?.originalThumbnailUrl,
            jpegThumbnail: preferFallbackImage ? fallback.jpegThumbnail : info?.jpegThumbnail,
            highQualityThumbnail: preferFallbackImage ? fallback.highQualityThumbnail : info?.highQualityThumbnail
          } as WAUrlInfo;
        }
      }
      if (!info?.title) throw new Error("A página do produto não retornou metadados para o preview.");
      info["matched-text"] = matched;
      return info;
    } catch (error) {
      console.warn({
        event: "offer_link_preview_failed",
        component: "queue",
        dispatch_id: correlationId(dispatchId),
        preview_url: matched,
        ...errorFields(error)
      });
      return undefined;
    }
  }

  /**
   * Any failure here (auth, missing offer, network, thumbnail) must fall back
   * to the generic scraper in the caller instead of aborting the whole
   * preview — so every failure is caught and logged with its exact reason
   * here, never left to bubble up as a silent "no preview at all".
   */
  private async getShopeeProductPreview(accountId: string, itemId: string, dispatchId: string, sock: any): Promise<WAUrlInfo | undefined> {
    const logSkip = (reason: string, extra: Record<string, unknown> = {}) => {
      console.warn({ event: "offer_shopee_product_preview_skipped", component: "queue", dispatch_id: correlationId(dispatchId), item_id: itemId, reason, ...extra });
      return undefined;
    };
    try {
      if (!/^\d+$/.test(itemId)) return logSkip("invalid_item_id");
      const { data: integration, error } = await supabase.from("affiliate_integrations")
        .select("app_id,encrypted_app_secret").eq("account_id", accountId)
        .eq("provider", "shopee").eq("status", "connected").maybeSingle();
      if (error || !integration?.app_id || !integration?.encrypted_app_secret) return logSkip("shopee_not_connected");
      const query = `query { productOfferV2(itemId: ${itemId}, page: 1, limit: 1) { nodes { itemId productName imageUrl productLink } } }`;
      const body = JSON.stringify({ query });
      const timestamp = String(Math.floor(Date.now() / 1000));
      const signature = createHash("sha256").update(`${integration.app_id}${timestamp}${body}${decryptIntegrationSecret(integration.encrypted_app_secret)}`).digest("hex");
      const response = await axios.post("https://open-api.affiliate.shopee.com.br/graphql", body, {
        timeout: 10_000,
        validateStatus: () => true,
        headers: { "content-type": "application/json", authorization: `SHA256 Credential=${integration.app_id}, Timestamp=${timestamp}, Signature=${signature}` }
      });
      if (response.status < 200 || response.status >= 300) return logSkip("http_error", { status: response.status });
      const apiError = response.data?.errors?.[0];
      if (apiError) return logSkip("graphql_error", { message: apiError.extensions?.message || apiError.message, code: apiError.extensions?.code });
      const product = response.data?.data?.productOfferV2?.nodes?.find((node: any) => String(node.itemId) === itemId);
      if (!product) return logSkip("item_not_in_active_offer");
      if (!product.productName || !product.imageUrl || !product.productLink) return logSkip("incomplete_product_fields");
      const imageUrl = new URL(product.imageUrl);
      if (imageUrl.protocol !== "https:" || imageUrl.hostname !== "cf.shopee.com.br") return logSkip("unexpected_image_host", { host: imageUrl.hostname });
      const image = await axios.get<ArrayBuffer>(imageUrl.toString(), {
        timeout: 10_000, responseType: "arraybuffer", maxContentLength: 2_000_000, validateStatus: () => true
      });
      if (image.status < 200 || image.status >= 300) return logSkip("image_download_failed", { status: image.status });
      if (!String(image.headers["content-type"] || "").startsWith("image/")) return logSkip("image_not_image_content_type");
      // Sobe a imagem pros servidores do WhatsApp (mesmo passo que o preview
      // "de alta qualidade" do Baileys faz sozinho) em vez de só comprimir uma
      // miniatura localmente — é isso que faz o card sair grande de verdade.
      const { imageMessage } = await prepareWAMessageMedia({ image: { url: imageUrl.toString() } }, {
        upload: sock.waUploadToServer,
        mediaTypeOverride: "thumbnail-link",
        options: { timeout: 10_000 }
      });
      return {
        "canonical-url": product.productLink,
        "matched-text": "",
        title: product.productName,
        description: "shopee.com.br",
        originalThumbnailUrl: imageUrl.toString(),
        jpegThumbnail: imageMessage?.jpegThumbnail ? Buffer.from(imageMessage.jpegThumbnail) : undefined,
        highQualityThumbnail: imageMessage || undefined
      };
    } catch (error) {
      console.warn({ event: "offer_shopee_product_preview_skipped", component: "queue", dispatch_id: correlationId(dispatchId), item_id: itemId, reason: "exception", ...errorFields(error) });
      return undefined;
    }
  }

  /**
   * Generic OG-tag fallback for hosts without a dedicated product API (Amazon,
   * Mercado Livre): fetches the page ourselves with browser-like headers,
   * since a bot-identifying user-agent (or none) can get served a page
   * without the real og:image/og:title — the same failure mode already
   * handled for Shopee via its official API instead.
   */
  private async scrapeOgImageAndMeta(url: string, dispatchId: string, sock: any): Promise<WAUrlInfo | undefined> {
    const logSkip = (reason: string, extra: Record<string, unknown> = {}) => {
      console.warn({ event: "offer_generic_og_preview_skipped", component: "queue", dispatch_id: correlationId(dispatchId), preview_url: url, reason, ...extra });
      return undefined;
    };
    const fetchHtml = (target: string) => axios.get<string>(target, {
      timeout: 10_000,
      responseType: "text",
      validateStatus: () => true,
      maxContentLength: 3_000_000,
      maxRedirects: 5,
      headers: {
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-language": "pt-BR,pt;q=0.9,en;q=0.8"
      }
    });
    try {
      const page = await fetchHtml(url);
      if (page.status < 200 || page.status >= 300 || typeof page.data !== "string") return logSkip("http_error", { status: page.status });
      let effectiveUrl = url;
      const html = page.data;
      // Um link de afiliado do Mercado Livre normalmente abre uma vitrine
      // (/social/<campanha>) em vez do produto específico, e a página do
      // produto (/p/MLBxxxx) é bloqueada por uma verificação de segurança
      // quando acessada direto por um servidor (responde 200, mas com uma
      // página de "Segurança — Mercado Livre" genérica) — então não dá pra
      // simplesmente buscar de novo a página do produto encontrado. A
      // vitrine já tem og:title/og:image corretos do produto em destaque
      // (verificado manualmente: o id da imagem bate com o do card
      // destacado); só troca a URL "canônica" mostrada pra a do produto.
      if (/(^|\.)mercadolivre\.com\.br$/i.test(new URL(url).hostname) && new URL(url).pathname.startsWith("/social/")) {
        const featured = extractFeaturedSocialProduct(html);
        if (featured?.url) effectiveUrl = featured.url;
      }
      const title = extractOgMeta(html, "title");
      const description = extractOgMeta(html, "description");
      const isAmazon = /(^|\.)amazon\.com\.br$/i.test(new URL(effectiveUrl).hostname);
      const imageRaw = (isAmazon && extractAmazonProductImage(html)) || extractOgMeta(html, "image");
      let originalThumbnailUrl: string | undefined;
      let jpegThumbnail: Buffer | undefined;
      let highQualityThumbnail: any;
      if (imageRaw) {
        try {
          const imageUrl = new URL(imageRaw, effectiveUrl);
          if (imageUrl.protocol === "https:") {
            const { imageMessage } = await prepareWAMessageMedia({ image: { url: imageUrl.toString() } }, {
              upload: sock.waUploadToServer,
              mediaTypeOverride: "thumbnail-link",
              options: { timeout: 10_000 }
            });
            if (imageMessage) {
              originalThumbnailUrl = imageUrl.toString();
              jpegThumbnail = imageMessage.jpegThumbnail ? Buffer.from(imageMessage.jpegThumbnail) : undefined;
              highQualityThumbnail = imageMessage;
            }
          }
        } catch (imageError) {
          logSkip("image_download_failed", errorFields(imageError));
        }
      }
      if (!title && !jpegThumbnail && !highQualityThumbnail) return logSkip("no_usable_metadata");
      return {
        "canonical-url": effectiveUrl,
        "matched-text": "",
        title: title || "",
        description: description || new URL(effectiveUrl).hostname,
        originalThumbnailUrl,
        jpegThumbnail,
        highQualityThumbnail
      };
    } catch (error) {
      return logSkip("exception", errorFields(error));
    }
  }

  private async getGroupMentions(sock: any, groupJid: string) {
    const metadata = await withTimeout<any>("groups.mentions", env.GROUP_SYNC_TIMEOUT_MS, sock.groupMetadata(groupJid));
    const ownId = String(sock.user?.id || "").split(":")[0];
    return (metadata.participants || []).map((participant: any) => participant.id)
      .filter((jid: string) => jid && !jid.startsWith(`${ownId}@`));
  }

  private async persistSuccess(table: QueueTableName, row: any, messageId: string | null) {
    if (!messageId) {
      await this.markUncertain(table, row, "O WhatsApp não retornou o identificador da mensagem.", "MISSING_MESSAGE_ID");
      return;
    }
    try {
      const completed = await dbResult<boolean>("queue.persist-success", supabase.rpc("complete_whatsapp_job_sent", {
        p_worker_id: env.INSTANCE_ID,
        p_queue_table: table,
        p_message_id: row.id,
        p_claim_token: row.claim_token,
        p_lease_version: row.processing_lease_version,
        p_wa_message_id: messageId
      }));
      if (!completed) throw new Error("Fencing token expirou antes da confirmação do envio.");
      if (table === "envios_grupo") await this.recalc(row.lote_id);
      if (table === "envios_grupo") await this.syncOfferDelivery(row.id, "sent", null, new Date().toISOString());
      console.info({ event: "queue.sent", component: "queue", jobId: correlationId(row.id), messageId: correlationId(messageId) });
    } catch (error) {
      await this.markForReconciliation(table, row, messageId, error);
    }
  }

  private async markForReconciliation(table: QueueTableName, row: any, messageId: string | null, cause: unknown) {
    const reason = "Mensagem aceita pelo WhatsApp, mas a confirmação não foi persistida. Não reenviar automaticamente.";
    const key = `${table}:${row.id}`;
    try {
      await dbResult("queue.mark-reconciliation", supabase.from(table).update(this.updateFields(table, {
        status: "incerto",
        reconciliation_required: true,
        last_error_code: "PERSIST_SUCCESS_FAILED",
        wa_message_id: messageId,
        erro: reason,
        claim_token: null,
        processing_deadline_at: null,
        updated_at: new Date().toISOString()
      })).eq("id", row.id));
      if (table === "envios_grupo") await this.recalc(row.lote_id);
    } catch (reconciliationError) {
      this.reconciliation.set(key, { table, row, messageId, reason });
      console.error({ event: "queue.reconciliation_deferred", component: "queue", jobId: correlationId(row.id), ...errorFields(reconciliationError) });
    }
    console.error({ event: "queue.persist_success_failed", component: "queue", jobId: correlationId(row.id), ...errorFields(cause) });
  }

  private async flushReconciliation() {
    for (const [key, item] of this.reconciliation) {
      try {
        await dbResult("queue.reconcile", supabase.from(item.table).update(this.updateFields(item.table, {
          status: "incerto",
          reconciliation_required: true,
          last_error_code: "PERSIST_SUCCESS_FAILED",
          wa_message_id: item.messageId,
          erro: item.reason,
          claim_token: null,
          processing_deadline_at: null,
          updated_at: new Date().toISOString()
        })).eq("id", item.row.id));
        if (item.table === "envios_grupo") await this.recalc(item.row.lote_id);
        this.reconciliation.delete(key);
      } catch {
        break;
      }
    }
  }

  private async markFailure(table: QueueTableName, row: any, message: string, code = "SEND_FAILED") {
    const disconnected = /desconectad|Nenhum número conectado|não autenticada/i.test(message);
    const attempts = disconnected ? (row.attempts || 0) : (row.attempts || 0) + 1;
    const delay = disconnected ? env.RETRY_BASE_DELAY_MS : retryDelay(attempts);
    await dbResult("queue.mark-failure", supabase.from(table).update(this.updateFields(table, {
      status: delay ? "pendente" : "erro",
      attempts,
      erro: message,
      last_error_code: code,
      claim_token: null,
      processing_deadline_at: null,
      last_attempt_at: new Date().toISOString(),
      next_attempt_at: delay ? new Date(Date.now() + delay).toISOString() : null,
      updated_at: new Date().toISOString()
    })).eq("id", row.id).eq("claim_token", row.claim_token)
      .eq("processing_worker_id", env.INSTANCE_ID).eq("processing_lease_version", row.processing_lease_version));
    await supabase.rpc("record_whatsapp_session_failure", {
      p_worker_id: env.INSTANCE_ID,
      p_session_id: row.whatsapp_session_id,
      p_lease_version: row.processing_lease_version,
      p_threshold: env.CIRCUIT_BREAKER_FAILURE_THRESHOLD,
      p_cooldown_seconds: Math.ceil(env.CIRCUIT_BREAKER_COOLDOWN_MS / 1000),
      p_error: message
    });
    if (table === "envios_grupo") await this.recalc(row.lote_id);
    if (table === "envios_grupo") await this.syncOfferDelivery(row.id, delay ? "scheduled" : "failed", message);
  }

  private async markUncertain(table: QueueTableName, row: any, message: string, code: string) {
    await dbResult("queue.mark-uncertain", supabase.from(table).update(this.updateFields(table, {
      status: "incerto",
      erro: message,
      last_error_code: code,
      reconciliation_required: true,
      claim_token: null,
      processing_deadline_at: null,
      updated_at: new Date().toISOString()
    })).eq("id", row.id).eq("claim_token", row.claim_token)
      .eq("processing_worker_id", env.INSTANCE_ID).eq("processing_lease_version", row.processing_lease_version));
    if (table === "envios_grupo") await this.recalc(row.lote_id);
    if (table === "envios_grupo") await this.syncOfferDelivery(row.id, "uncertain", message);
  }

  private async syncOfferDelivery(dispatchId: string, status: "scheduled" | "sending" | "sent" | "failed" | "uncertain" | "cancelled", errorMessage?: string | null, sentAt?: string) {
    const values = { status, error_message: errorMessage || null, sent_at: sentAt || null, updated_at: new Date().toISOString() };
    const { data: delivery, error } = await supabase.from("offer_deliveries").update(values)
      .eq("group_dispatch_id", dispatchId).select("offer_id,account_id").maybeSingle();
    if (error) {
      if (["42P01", "PGRST205"].includes(error.code || "")) return;
      throw error;
    }
    if (!delivery) return;
    const { data: rows, error: rowsError } = await supabase.from("offer_deliveries").select("status,sent_at")
      .eq("offer_id", delivery.offer_id).eq("account_id", delivery.account_id);
    if (rowsError) throw rowsError;
    const statuses = (rows || []).map((row) => row.status);
    const allSent = statuses.length > 0 && statuses.every((value) => value === "sent");
    const allCancelled = statuses.length > 0 && statuses.every((value) => value === "cancelled");
    const allTerminal = statuses.every((value) => ["sent", "failed", "uncertain", "cancelled"].includes(value));
    const hasSuccess = statuses.includes("sent");
    const offerStatus = allCancelled ? "ignored" : allSent || (allTerminal && hasSuccess) ? "sent" : allTerminal ? "send_failed" : statuses.includes("sending") ? "sending" : "scheduled";
    const offerValues: Record<string, unknown> = { status: offerStatus, updated_at: new Date().toISOString() };
    if (offerStatus === "sent") offerValues.sent_at = sentAt || new Date().toISOString();
    await supabase.from("captured_offers").update(offerValues).eq("id", delivery.offer_id).eq("account_id", delivery.account_id);
    console.info({ event: status === "sent" ? "offer_sent" : status === "failed" ? "offer_send_failed" : `offer_${status}`, component: "offer-autopilot", offer_id: delivery.offer_id, destination_dispatch_id: correlationId(dispatchId) });
  }

  private async recalc(loteId: string) {
    try {
      await dbResult("queue.recalc-lote", supabase.rpc("recalc_lote_counts", { p_lote_id: loteId }));
      return;
    } catch (error) {
      if (!isMissingRpc(error, "recalc_lote_counts")) throw error;
    }
    const { data: rows, error: rowsError } = await supabase.from("envios_grupo").select("status").eq("lote_id", loteId);
    if (rowsError) throw rowsError;
    const statuses = (rows || []).map((row: any) => row.status);
    const total = statuses.length;
    const enviados = statuses.filter((status) => status === "sucesso").length;
    const erros = statuses.filter((status) => status === "erro").length;
    const incertos = statuses.filter((status) => status === "incerto").length;
    const processando = statuses.filter((status) => status === "processando").length;
    const enfileirados = statuses.filter((status) => status === "enfileirado").length;
    const pendentes = statuses.filter((status) => status === "pendente").length;
    const status = pendentes || enfileirados ? "pendente" : processando ? "processando" : incertos ? "incerto" : enviados === total && total ? "sucesso" : erros === total && total ? "erro" : "concluido_com_erros";
    const { error: updateError } = await supabase.from("envios_grupo_lotes").update({
      status, total, enviados, erros, incertos, processando, enfileirados, pendentes, updated_at: new Date().toISOString()
    }).eq("id", loteId);
    if (updateError) throw updateError;
  }

  private async returnQueuedToPending() {
    for (const table of ["envios", "envios_grupo"] as const) {
      await dbResult("queue.release-buffer", supabase.from(table).update(this.updateFields(table, {
        status: "pendente",
        claim_token: null,
        processing_deadline_at: null,
        updated_at: new Date().toISOString()
      })).eq("status", "enfileirado"));
    }
    this.buffer = [];
  }
}
