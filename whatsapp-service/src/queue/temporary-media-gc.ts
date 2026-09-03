import { env } from "../env.js";
import { supabase } from "../supabase.js";

const ACTIVE_GROUP_STATUSES = ["pendente", "enfileirado", "processando", "pausado", "incerto"];
const ACTIVE_OFFER_STATUSES = ["captured", "processing", "ready", "scheduled", "sending", "processing_failed", "send_failed"];
const TEMPORARY_BUCKETS = ["whatsapp-media", "offer-media"] as const;

type ObjectRow = { name: string; created_at?: string; metadata?: { size?: number | string } };
type PathRef = { media_bucket: string | null; media_path: string | null };

/** Deletes only media that is unreferenced by every active or permanent workflow. */
export class TemporaryMediaGarbageCollector {
  private lastRunAt = 0;

  async runIfDue() {
    if (Date.now() - this.lastRunAt < env.TEMPORARY_MEDIA_GC_INTERVAL_MS) return;
    this.lastRunAt = Date.now();
    await this.run();
  }

  async run() {
    const keep = await this.pathsToKeep();
    const cutoff = Date.now() - env.TEMPORARY_MEDIA_GC_MIN_AGE_MS;
    let scanned = 0; let removed = 0; let freedBytes = 0;

    for (const bucket of TEMPORARY_BUCKETS) {
      const objects = await this.listAll(bucket);
      scanned += objects.length;
      const candidates = objects.filter((object) => !keep.has(`${bucket}:${object.name}`) && this.isOldEnough(object, cutoff));
      for (let index = 0; index < candidates.length; index += 100) {
        const chunk = candidates.slice(index, index + 100);
        const { error } = await supabase.storage.from(bucket).remove(chunk.map((object) => object.name));
        if (error) throw error;
        removed += chunk.length;
        freedBytes += chunk.reduce((sum, object) => sum + Number(object.metadata?.size || 0), 0);
        await this.clearTerminalReferences(bucket, chunk.map((object) => object.name));
      }
    }
    console.info({ event: "temporary_media_gc_completed", component: "media-gc", scanned, removed, freed_bytes: freedBytes, preserved: scanned - removed });
    return { scanned, removed, freedBytes, preserved: scanned - removed };
  }

  private isOldEnough(object: ObjectRow, cutoff: number) {
    return Boolean(object.created_at && new Date(object.created_at).getTime() < cutoff);
  }

  private async pathsToKeep() {
    const [jobs, lots, offers, templates, quickReplies] = await Promise.all([
      supabase.from("envios_grupo").select("media_bucket,media_path").in("status", ACTIVE_GROUP_STATUSES),
      supabase.from("envios_grupo_lotes").select("media_bucket,media_path").in("status", ["pendente", "processando", "pausado", "incerto"]),
      supabase.from("captured_offers").select("media_bucket,media_path").in("status", ACTIVE_OFFER_STATUSES),
      supabase.from("modelos_mensagem").select("media_bucket,media_path"),
      supabase.from("official_quick_reply_actions").select("media_bucket,media_path")
    ]);
    for (const result of [jobs, lots, offers, templates, quickReplies]) if (result.error && !["42P01", "PGRST205"].includes(result.error.code || "")) throw result.error;
    const paths = new Set<string>();
    for (const result of [jobs, lots, offers, templates, quickReplies]) {
      for (const row of (result.data || []) as PathRef[]) if (row.media_bucket && row.media_path) paths.add(`${row.media_bucket}:${row.media_path}`);
    }
    return paths;
  }

  private async listAll(bucket: string, prefix = ""): Promise<ObjectRow[]> {
    const { data, error } = await supabase.storage.from(bucket).list(prefix, { limit: 1000, sortBy: { column: "name", order: "asc" } });
    if (error) throw error;
    const all: ObjectRow[] = [];
    for (const item of (data || []) as ObjectRow[]) {
      const name = prefix ? `${prefix}/${item.name}` : item.name;
      if (item.metadata) all.push({ ...item, name });
      else all.push(...await this.listAll(bucket, name));
    }
    return all;
  }

  private async clearTerminalReferences(bucket: string, paths: string[]) {
    if (!paths.length) return;
    const now = new Date().toISOString();
    const terminalGroupStatuses = ["sucesso", "erro", "cancelado", "concluido_com_erros"];
    const terminalOfferStatuses = ["sent", "ignored", "duplicate"];
    const results = await Promise.all([
      supabase.from("envios_grupo").update({ media_bucket: null, media_path: null, updated_at: now }).eq("media_bucket", bucket).in("media_path", paths).in("status", terminalGroupStatuses),
      supabase.from("envios_grupo_lotes").update({ media_bucket: null, media_path: null, updated_at: now }).eq("media_bucket", bucket).in("media_path", paths).in("status", terminalGroupStatuses),
      supabase.from("captured_offers").update({ media_bucket: null, media_path: null, updated_at: now }).eq("media_bucket", bucket).in("media_path", paths).in("status", terminalOfferStatuses)
    ]);
    for (const result of results) if (result.error && !["42P01", "PGRST205"].includes(result.error.code || "")) throw result.error;
  }
}
