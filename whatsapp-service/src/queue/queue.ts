import { env } from "../env.js";
import { supabase } from "../supabase.js";
import { downloadMedia, buildBaileysMessage, convertVoiceToOpus } from "../utils/media.js";
import { phoneToWhatsAppJid, validateGroupJid } from "../utils/phone.js";
import type { WhatsAppRuntime } from "../whatsapp.js";

type QueueItem = { id: string; kind: "envio" | "grupo"; priority: "alta" | "normal"; claim_token: string };

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const random = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min;
const backoff = (attempts: number) => attempts <= 1 ? 60_000 : attempts === 2 ? 5 * 60_000 : null;
const isEmptyCompositeResult = (error: any) => error?.code === "22P02" && String(error?.message || "").includes('uuid: "null"');

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
        if (this.runtime.getStatus() !== "connected") {
          await this.returnQueuedToPending();
          await sleep(3000);
          continue;
        }
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
    const { data: envio, error: envioError } = await supabase.rpc("claim_next_envio");
    if (envioError && !isEmptyCompositeResult(envioError)) throw envioError;
    if (envio) { this.buffer.push({ id: envio.id, kind: "envio", priority: "alta", claim_token: envio.claim_token }); return; }
    const { data: grupo, error: grupoError } = await supabase.rpc("claim_next_envio_grupo");
    if (grupoError && !isEmptyCompositeResult(grupoError)) throw grupoError;
    if (grupo) this.buffer.push({ id: grupo.id, kind: "grupo", priority: "normal", claim_token: grupo.claim_token });
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
      await sleep(item.kind === "envio" ? random(3000, 8000) : random(20_000, 45_000));
      if (item.kind === "envio") await this.sendWelcome(row);
      else await this.sendGroup(row);
      this.lastSendAt = Date.now();
    } catch (e: any) {
      await this.markFailure(table, row, e.message || "Falha no envio.");
    }
  }

  private async sendWelcome(row: any) {
    const optOut = await supabase.from("opt_outs").select("id").or(`telefone.eq.${row.telefone},email.eq.${row.email}`).limit(1);
    if (optOut.data?.length) throw new Error("Contato em opt-out.");
    const jid = phoneToWhatsAppJid(row.telefone);
    const result = await this.runtime.sock.sendMessage(jid, { text: row.mensagem_enviada });
    await supabase.from("envios").update({ status: "sucesso", sent_at: new Date().toISOString(), wa_message_id: result?.key?.id || null, updated_at: new Date().toISOString() }).eq("id", row.id);
  }

  private async sendGroup(row: any) {
    if (!validateGroupJid(row.group_jid)) throw new Error("JID de grupo inválido.");
    let media: Buffer | undefined;
    if (row.media_bucket && row.media_path) {
      media = await downloadMedia(row.media_bucket, row.media_path);
      if (row.tipo === "audio_voz") media = await convertVoiceToOpus(media);
    }
    const result = await this.runtime.sock.sendMessage(row.group_jid, buildBaileysMessage(row, media));
    await supabase.from("envios_grupo").update({ status: "sucesso", sent_at: new Date().toISOString(), wa_message_id: result?.key?.id || null, updated_at: new Date().toISOString() }).eq("id", row.id);
    await supabase.rpc("recalc_lote_counts", { p_lote_id: row.lote_id });
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

  private async returnQueuedToPending() {
    for (const table of ["envios", "envios_grupo"]) {
      await supabase.from(table).update({ status: "pendente", claim_token: null, updated_at: new Date().toISOString() }).eq("status", "enfileirado");
    }
    this.buffer = [];
  }
}
