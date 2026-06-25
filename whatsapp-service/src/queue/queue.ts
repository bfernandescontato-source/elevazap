import { env } from "../env.js";
import { supabase } from "../supabase.js";
import { downloadMedia, buildBaileysMessage, convertVoiceToOpus } from "../utils/media.js";
import { phoneToWhatsAppJid, validateGroupJid } from "../utils/phone.js";
import type { WhatsAppRuntime } from "../whatsapp.js";
import { randomUUID } from "crypto";
import { getSenderSock } from "../senders/runtime.js";

type QueueItem = { id: string; kind: "envio" | "grupo"; priority: "alta" | "normal"; claim_token: string };

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const random = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min;
const backoff = (attempts: number) => attempts <= 1 ? 60_000 : attempts === 2 ? 5 * 60_000 : null;

export class GlobalSendQueue {
  private buffer: QueueItem[] = [];
  private running = false;
  private lastSendAt = 0;

  constructor(private runtime: WhatsAppRuntime) {}

  stats() {
    return {
      size: this.buffer.length,
      highPriority: this.buffer.filter((i) => i.priority === "alta").length,
      normalPriority: this.buffer.filter((i) => i.priority === "normal").length
    };
  }

  start() {
    if (this.running) return;
    this.running = true;
    void this.loop();
  }

  private async loop() {
    while (this.running) {
      try {
        if (this.buffer.length < 1) await this.claimNext();
        const item = this.buffer.shift();
        if (item) await this.process(item);
        else await sleep(2000);
      } catch (error) {
        console.error("queue-loop", error);
        await sleep(3000);
      }
    }
  }

  private async claimNext() {
    const envio = await this.claimTableItem("envios", { onlyWithSender: this.runtime.getStatus() !== "connected" });
    if (envio) { this.buffer.push({ id: envio.id, kind: "envio", priority: "alta", claim_token: envio.claim_token }); return; }
    const grupo = await this.claimTableItem("envios_grupo");
    if (grupo) {
      await supabase.from("envios_grupo_lotes")
        .update({ status: "processando", started_at: grupo.started_at, updated_at: new Date().toISOString() })
        .eq("id", grupo.lote_id)
        .in("status", ["pendente", "processando"]);
      await supabase.rpc("recalc_lote_counts", { p_lote_id: grupo.lote_id });
      this.buffer.push({ id: grupo.id, kind: "grupo", priority: "normal", claim_token: grupo.claim_token });
    }
  }

  private async claimTableItem(table: "envios" | "envios_grupo", options: { onlyWithSender?: boolean } = {}) {
    const now = new Date().toISOString();
    let query = supabase.from(table)
      .select("*")
      .eq("status", "pendente")
      .lte("scheduled_at", now)
      .or(`next_attempt_at.is.null,next_attempt_at.lte.${now}`)
      .order("scheduled_at", { ascending: true })
      .order("created_at", { ascending: true })
      .limit(1);
    if (options.onlyWithSender) query = query.not("whatsapp_session_name", "is", null);

    const { data: job, error: selectError } = await query.maybeSingle();
    if (selectError?.code === "42703" && options.onlyWithSender) return null;
    if (selectError) throw selectError;
    if (!job) return null;

    const claimToken = randomUUID();
    const { data: claimed, error: updateError } = await supabase.from(table)
      .update({ status: "enfileirado", claimed_at: now, claim_token: claimToken, updated_at: now })
      .eq("id", job.id)
      .eq("status", "pendente")
      .select("*")
      .maybeSingle();
    if (updateError) throw updateError;
    return claimed;
  }

  private async process(item: QueueItem) {
    const table = item.kind === "envio" ? "envios" : "envios_grupo";
    const { data: row, error } = await supabase.from(table)
      .update({ status: "processando", started_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("id", item.id)
      .eq("status", "enfileirado")
      .eq("claim_token", item.claim_token)
      .select("*")
      .maybeSingle();
    if (error) throw error;
    if (!row) return;

    try {
      const throttleWait = Math.max(0, env.GLOBAL_SEND_THROTTLE_MS - (Date.now() - this.lastSendAt));
      if (throttleWait) await sleep(throttleWait);
      if (item.kind === "envio" && row.source !== "massa_manual") await sleep(random(3000, 8000));
      if (item.kind === "envio") await this.sendWelcome(row);
      else await this.sendGroup(row);
      this.lastSendAt = Date.now();
    } catch (e: any) {
      await this.markFailure(table, row, e.message || "Falha no envio.");
    }
  }

  private async sendWelcome(row: any) {
    const sock = row.whatsapp_session_name ? getSenderSock(row.whatsapp_session_name) : this.runtime.sock;
    if (!sock) throw new Error(row.whatsapp_session_name ? "Número responsável pelo disparo está desconectado." : "Número principal desconectado.");
    const optOut = await supabase.from("opt_outs").select("id").or(`telefone.eq.${row.telefone},email.eq.${row.email}`).limit(1);
    if (optOut.data?.length) throw new Error("Contato em opt-out.");
    const jid = await this.resolveWhatsAppContact(sock, row);
    if (!jid) return;
    const result = await sock.sendMessage(jid, { text: row.mensagem_enviada });
    const waMessageId = result?.key?.id || null;
    if (!waMessageId) {
      await this.markUncertain("envios", row, "WhatsApp aceitou a chamada, mas não retornou ID da mensagem.");
      return;
    }
    console.log("welcome-sent", { id: row.id, jid, waMessageId });
    await supabase.from("envios").update({ status: "sucesso", sent_at: new Date().toISOString(), wa_message_id: waMessageId, erro: null, updated_at: new Date().toISOString() }).eq("id", row.id);
  }

  private async resolveWhatsAppContact(sock: any, row: any) {
    const fallbackJid = phoneToWhatsAppJid(row.telefone);
    if (typeof sock.onWhatsApp !== "function") return fallbackJid;

    const phone = fallbackJid.replace("@s.whatsapp.net", "");
    const result = await sock.onWhatsApp(phone, fallbackJid);
    const match = (result || []).find((item: any) => item?.exists && item?.jid);
    if (match?.jid) {
      console.log("whatsapp-contact-found", { id: row.id, phone, jid: match.jid });
      return match.jid;
    }

    await this.markPermanentFailure("envios", row, "Telefone não encontrado no WhatsApp. Confira se o número está correto e tem WhatsApp ativo.");
    return null;
  }

  private async sendGroup(row: any) {
    if (!validateGroupJid(row.group_jid)) throw new Error("JID de grupo inválido.");
    const sock = row.whatsapp_session_name ? getSenderSock(row.whatsapp_session_name) : this.runtime.sock;
    if (!sock) throw new Error("Número responsável pelo disparo está desconectado.");
    let media: Buffer | undefined;
    if (row.media_bucket && row.media_path) {
      media = await downloadMedia(row.media_bucket, row.media_path);
      if (row.tipo === "audio_voz") media = await convertVoiceToOpus(media);
    }
    const mentions = row.mention_all ? await this.getGroupMentions(sock, row.group_jid) : [];
    const result = await sock.sendMessage(row.group_jid, buildBaileysMessage(row, media, mentions));
    const waMessageId = result?.key?.id || null;
    if (!waMessageId) {
      await this.markUncertain("envios_grupo", row, "WhatsApp aceitou a chamada, mas não retornou ID da mensagem.");
      return;
    }
    console.log("group-sent", { id: row.id, groupJid: row.group_jid, waMessageId });
    await supabase.from("envios_grupo").update({ status: "sucesso", sent_at: new Date().toISOString(), wa_message_id: waMessageId, erro: null, updated_at: new Date().toISOString() }).eq("id", row.id);
    await supabase.rpc("recalc_lote_counts", { p_lote_id: row.lote_id });
  }

  private async getGroupMentions(sock: any, groupJid: string) {
    const metadata = await sock.groupMetadata(groupJid);
    const ownId = String(sock.user?.id || "").split(":")[0];
    return (metadata.participants || [])
      .map((participant: any) => participant.id)
      .filter((jid: string) => jid && !jid.startsWith(`${ownId}@`));
  }

  private async markFailure(table: string, row: any, message: string) {
    const attempts = (row.attempts || 0) + 1;
    const next = backoff(attempts);
    const status = next ? "pendente" : "erro";
    await supabase.from(table).update({
      status,
      attempts,
      erro: message,
      claim_token: null,
      last_attempt_at: new Date().toISOString(),
      next_attempt_at: next ? new Date(Date.now() + next).toISOString() : null,
      updated_at: new Date().toISOString()
    }).eq("id", row.id);
    if (table === "envios_grupo") await supabase.rpc("recalc_lote_counts", { p_lote_id: row.lote_id });
  }

  private async markPermanentFailure(table: string, row: any, message: string) {
    await supabase.from(table).update({
      status: "erro",
      attempts: (row.attempts || 0) + 1,
      erro: message,
      claim_token: null,
      last_attempt_at: new Date().toISOString(),
      next_attempt_at: null,
      updated_at: new Date().toISOString()
    }).eq("id", row.id);
    if (table === "envios_grupo") await supabase.rpc("recalc_lote_counts", { p_lote_id: row.lote_id });
  }

  private async markUncertain(table: string, row: any, message: string) {
    await supabase.from(table).update({
      status: "incerto",
      erro: message,
      claim_token: null,
      sent_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }).eq("id", row.id);
    if (table === "envios_grupo") await supabase.rpc("recalc_lote_counts", { p_lote_id: row.lote_id });
  }

  private async returnQueuedToPending() {
    for (const table of ["envios", "envios_grupo"]) {
      await supabase.from(table).update({ status: "pendente", claim_token: null, updated_at: new Date().toISOString() }).eq("status", "enfileirado");
    }
    this.buffer = [];
  }
}
