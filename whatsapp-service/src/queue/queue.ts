import { randomUUID } from "crypto";
import { env } from "../env.js";
import { supabase } from "../supabase.js";
import { downloadMedia, buildBaileysMessage, convertVoiceToOpus } from "../utils/media.js";
import { phoneToWhatsAppJid, validateGroupJid } from "../utils/phone.js";
import { dbResult } from "../utils/db.js";
import { correlationId, errorFields } from "../utils/log.js";
import { OperationTimeoutError, withTimeout } from "../utils/timeout.js";
import type { WhatsAppRuntime } from "../whatsapp.js";
import { getFirstConnectedSenderSock, getSenderSock } from "../senders/runtime.js";
import { compatibleQueueUpdate, type DatabaseCapabilities, type QueueTable } from "../database-capabilities.js";

type QueueItem = { id: string; kind: "envio" | "grupo"; priority: "alta" | "normal"; claim_token: string };
type TableName = QueueTable;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const random = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min;

function retryDelay(attempts: number) {
  if (attempts >= env.MAX_SEND_ATTEMPTS) return null;
  return env.RETRY_BASE_DELAY_MS * (attempts <= 1 ? 1 : 5 ** (attempts - 1));
}

export class GlobalSendQueue {
  private buffer: QueueItem[] = [];
  private running = false;
  private lastSendAt = 0;
  private reconciliation = new Map<string, { table: TableName; row: any; messageId: string | null; reason: string }>();

  constructor(private runtime: WhatsAppRuntime, private databaseCapabilities: DatabaseCapabilities) {}

  private updateFields(table: TableName, values: Record<string, unknown>) {
    return compatibleQueueUpdate(this.databaseCapabilities, table, values);
  }

  stats() {
    return {
      running: this.running,
      size: this.buffer.length,
      reconciliation: this.reconciliation.size,
      highPriority: this.buffer.filter((item) => item.priority === "alta").length,
      normalPriority: this.buffer.filter((item) => item.priority === "normal").length
    };
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
    return this.runtime.getStatus() === "connected" || getFirstConnectedSenderSock() !== null;
  }

  private async loop() {
    while (this.running) {
      try {
        await this.flushReconciliation();
        if (!this.hasAnyConnection()) {
          if (this.buffer.length) await this.returnQueuedToPending();
          await sleep(3_000);
          continue;
        }
        if (!this.buffer.length) await this.claimNext();
        const item = this.buffer.shift();
        if (item) await this.process(item);
        else await sleep(2_000);
      } catch (error) {
        console.error({ event: "queue.loop_failed", component: "queue", ...errorFields(error) });
        await sleep(3_000);
      }
    }
  }

  private async claimNext() {
    const envio = await dbResult<any>("queue.claim.envio", supabase.rpc("claim_next_envio"));
    if (envio?.id) {
      this.buffer.push({ id: envio.id, kind: "envio", priority: "alta", claim_token: envio.claim_token });
      return;
    }
    const grupo = await dbResult<any>("queue.claim.group", supabase.rpc("claim_next_envio_grupo"));
    if (grupo?.id) this.buffer.push({ id: grupo.id, kind: "grupo", priority: "normal", claim_token: grupo.claim_token });
  }

  private async process(item: QueueItem) {
    const table: TableName = item.kind === "envio" ? "envios" : "envios_grupo";
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

    try {
      await withTimeout("queue.item", env.QUEUE_PROCESSING_TIMEOUT_MS, this.execute(item, row));
    } catch (error) {
      const potentiallyDelivered = error instanceof OperationTimeoutError &&
        ["queue.item", "whatsapp.sendMessage"].includes(error.operation);
      if (potentiallyDelivered) await this.markUncertain(table, row, "O limite de tempo foi excedido durante o envio. Confirmação manual necessária.", "SEND_TIMEOUT");
      else await this.markFailure(table, row, error instanceof Error ? error.message : "Falha no envio.", (error as any)?.code);
    }
  }

  private async execute(item: QueueItem, row: any) {
    const throttleWait = Math.max(0, env.GLOBAL_SEND_THROTTLE_MS - (Date.now() - this.lastSendAt));
    if (throttleWait) await sleep(throttleWait);
    if (item.kind === "envio" && row.source !== "massa_manual") await sleep(random(3_000, 8_000));
    if (item.kind === "envio") await this.sendWelcome(row);
    else await this.sendGroup(row);
    this.lastSendAt = Date.now();
  }

  private selectSocket(row: any, group = false) {
    if (row.whatsapp_session_name) {
      const selected = getSenderSock(row.whatsapp_session_name);
      if (!selected) throw new Error("Número responsável pelo disparo está desconectado.");
      return selected;
    }
    if (this.runtime.getStatus() === "connected") return this.runtime.sock;
    if (!group) return getFirstConnectedSenderSock()?.sock || null;
    throw new Error("Número principal desconectado.");
  }

  private async sendWelcome(row: any) {
    const sock = this.selectSocket(row);
    if (!sock) throw new Error("Nenhum número conectado para disparo 1x1.");
    const optOuts = await dbResult<any[]>("queue.opt-out", supabase.from("opt_outs").select("id").or(`telefone.eq.${row.telefone},email.eq.${row.email}`).limit(1));
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

  private async persistSuccess(table: TableName, row: any, messageId: string | null) {
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
      console.info({ event: "queue.sent", component: "queue", jobId: correlationId(row.id), messageId: correlationId(messageId) });
    } catch (error) {
      await this.markForReconciliation(table, row, messageId, error);
    }
  }

  private async markForReconciliation(table: TableName, row: any, messageId: string | null, cause: unknown) {
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

  private async markFailure(table: TableName, row: any, message: string, code = "SEND_FAILED") {
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
  }

  private async markUncertain(table: TableName, row: any, message: string, code: string) {
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
  }

  private async recalc(loteId: string) {
    await dbResult("queue.recalc-lote", supabase.rpc("recalc_lote_counts", { p_lote_id: loteId }));
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
