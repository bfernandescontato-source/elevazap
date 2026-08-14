import { randomUUID } from "crypto";
import { env } from "../env.js";
import { supabase } from "../supabase.js";
import { downloadMedia, buildBaileysMessage, convertVoiceToOpus } from "../utils/media.js";
import { phoneToWhatsAppJid, validateGroupJid } from "../utils/phone.js";
import { dbResult } from "../utils/db.js";
import { correlationId, errorFields } from "../utils/log.js";
import { OperationTimeoutError, withTimeout } from "../utils/timeout.js";
import { getSenderSock, getSenderSockById, hasConnectedSender } from "../senders/runtime.js";
import { compatibleQueueUpdate, type DatabaseCapabilities } from "../database-capabilities.js";
import { QueueMetrics } from "./metrics.js";
import { isMissingRpc, queueSleep, randomDelay, retryDelay } from "./policy.js";
import type { QueueItem, QueueReconciliation, QueueTableName } from "./types.js";

export class GlobalSendQueue {
  private buffer: QueueItem[] = [];
  private running = false;
  private lastSendAt = 0;
  private lastStaleCleanupAt = 0;
  private consecutiveWelcomeClaims = 0;
  private reconciliation = new Map<string, QueueReconciliation>();
  private metrics = new QueueMetrics();

  constructor(private databaseCapabilities: DatabaseCapabilities) {}

  private updateFields(table: QueueTableName, values: Record<string, unknown>) {
    return compatibleQueueUpdate(this.databaseCapabilities, table, values);
  }

  stats() {
    return this.metrics.snapshot(this.running, this.buffer, this.reconciliation.size);
  }

  start() {
    if (this.running) return;
    this.running = true;
    void this.loop();
  }

  stop() {
    this.running = false;
  }

  private hasAnyConnection() {
    return hasConnectedSender();
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
        .in("status", ["enfileirado", "processando"])
        .not("processing_deadline_at", "is", null)
        .lt("processing_deadline_at", now);
    }
  }

  private async loop() {
    while (this.running) {
      try {
        await this.resetStaleItems();
        await this.flushReconciliation();
        if (!this.hasAnyConnection()) {
          if (this.buffer.length) await this.returnQueuedToPending();
          await queueSleep(3_000);
          continue;
        }
        if (!this.buffer.length) await this.claimNext();
        const item = this.buffer.shift();
        if (item) await this.process(item);
        else await queueSleep(2_000);
      } catch (error) {
        this.metrics.loopError(error);
        console.error({ event: "queue.loop_failed", component: "queue", ...errorFields(error) });
        await queueSleep(3_000);
      }
    }
  }

  private async claimNext() {
    // Do not let the high-priority 1x1 stream starve campaigns forever.
    // After a small burst, give one due group job a turn, then resume 1x1.
    if (this.consecutiveWelcomeClaims >= 5) {
      const group = await this.claimGroup();
      if (group) return;
    }

    const welcome = await this.claimWelcome();
    if (welcome) return;
    await this.claimGroup();
  }

  private async claimWelcome() {
    let envio: any;
    try {
      envio = await dbResult<any>("queue.claim.envio", supabase.rpc("claim_next_envio"));
    } catch (error) {
      if (!isMissingRpc(error, "claim_next_envio")) throw error;
      envio = await this.claimDirect("envios");
    }
    if (!envio?.id) envio = await this.claimDirect("envios");
    if (envio?.id) {
      this.metrics.claim();
      this.buffer.push({ id: envio.id, kind: "envio", priority: "alta", claim_token: envio.claim_token });
      this.consecutiveWelcomeClaims += 1;
      return true;
    }
    return false;
  }

  private async claimGroup() {
    let grupo: any;
    try {
      grupo = await dbResult<any>("queue.claim.group", supabase.rpc("claim_next_envio_grupo"));
    } catch (error) {
      if (!isMissingRpc(error, "claim_next_envio_grupo")) throw error;
      grupo = await this.claimDirect("envios_grupo");
    }
    if (!grupo?.id) grupo = await this.claimDirect("envios_grupo");
    if (grupo?.id) {
      this.metrics.claim();
      this.buffer.push({ id: grupo.id, kind: "grupo", priority: "normal", claim_token: grupo.claim_token });
      this.consecutiveWelcomeClaims = 0;
      return true;
    }
    return false;
  }

  private async claimDirect(table: QueueTableName) {
    const now = new Date();
    const nowIso = now.toISOString();
    const { data: candidates, error: selectError } = await supabase.from(table)
      .select("*").eq("status", "pendente").not("whatsapp_session_name", "is", null)
      .or(`next_attempt_at.is.null,next_attempt_at.lte.${nowIso}`)
      .or(`scheduled_at.is.null,scheduled_at.lte.${nowIso}`)
      .order("scheduled_at", { ascending: true, nullsFirst: true }).order("created_at", { ascending: true })
      .limit(20);
    if (selectError) throw selectError;
    const candidate = (candidates || [])[0];
    if (!candidate) return null;
    const claimToken = randomUUID();
    const { data, error } = await supabase.from(table).update(this.updateFields(table, {
      status: "enfileirado",
      claimed_at: nowIso,
      claim_token: claimToken,
      processing_deadline_at: new Date(now.getTime() + env.QUEUE_PROCESSING_TIMEOUT_MS).toISOString(),
      updated_at: nowIso
    })).eq("id", candidate.id).eq("status", "pendente").select("*").maybeSingle();
    if (error) throw error;
    return data ? { ...data, claim_token: claimToken } : null;
  }

  private async process(item: QueueItem) {
    const table: QueueTableName = item.kind === "envio" ? "envios" : "envios_grupo";
    const now = new Date();
    const row = await dbResult<any>(
      "queue.mark-processing",
      supabase.from(table).update(this.updateFields(table, {
        status: "processando",
        started_at: now.toISOString(),
        processing_deadline_at: new Date(now.getTime() + env.QUEUE_PROCESSING_TIMEOUT_MS).toISOString(),
        updated_at: now.toISOString()
      })).eq("id", item.id).eq("status", "enfileirado").eq("claim_token", item.claim_token).select("*").maybeSingle()
    );
    if (!row) return;

    if (table === "envios_grupo" && await this.cancelIfPilotDisabled(row)) return;
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
        await this.markFailure(table, row, error instanceof Error ? error.message : "Falha no envio.", (error as any)?.code);
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

  private async execute(item: QueueItem, row: any) {
    const throttleWait = Math.max(0, env.GLOBAL_SEND_THROTTLE_MS - (Date.now() - this.lastSendAt));
    if (throttleWait) await queueSleep(throttleWait);
    if (item.kind === "envio" && row.source !== "massa_manual") await queueSleep(randomDelay(3_000, 8_000));
    if (item.kind === "envio") await this.sendWelcome(row);
    else await this.sendGroup(row);
    this.lastSendAt = Date.now();
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
      media = await downloadMedia(row.media_bucket, row.media_path);
      if (row.tipo === "audio_voz") media = await convertVoiceToOpus(media);
    }
    const mentions = row.mention_all ? await this.getGroupMentions(sock, row.group_jid) : [];
    const result = await withTimeout<any>(
      "whatsapp.sendMessage",
      env.SEND_TIMEOUT_MS,
      sock.sendMessage(row.group_jid, buildBaileysMessage(row, media, mentions))
    );
    await this.persistSuccess("envios_grupo", row, result?.key?.id || null);
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
      await dbResult("queue.persist-success", supabase.from(table).update(this.updateFields(table, {
        status: "sucesso",
        sent_at: new Date().toISOString(),
        wa_message_id: messageId,
        erro: null,
        claim_token: null,
        processing_deadline_at: null,
        reconciliation_required: false,
        last_error_code: null,
        updated_at: new Date().toISOString()
      })).eq("id", row.id).eq("claim_token", row.claim_token));
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
    })).eq("id", row.id));
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
    })).eq("id", row.id));
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
