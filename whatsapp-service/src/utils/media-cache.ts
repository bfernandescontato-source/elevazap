type CacheEntry = { value: Buffer; bytes: number; lastUsedAt: number };

export type MediaCacheMetrics = {
  hits: number;
  misses: number;
  downloads: number;
  evictions: number;
  bytes: number;
  entries: number;
};

/**
 * Process-wide media cache. Queue jobs for different groups may run concurrently,
 * so the in-flight map is as important as the cache itself: it coalesces a burst
 * of requests for the same Supabase object into a single download.
 */
export class MediaCache {
  private entries = new Map<string, CacheEntry>();
  private inFlight = new Map<string, Promise<Buffer>>();
  private metrics: MediaCacheMetrics = { hits: 0, misses: 0, downloads: 0, evictions: 0, bytes: 0, entries: 0 };

  constructor(private readonly maxBytes: number, private readonly ttlMs: number, private readonly now = () => Date.now()) {}

  async getOrLoad(key: string, loader: () => Promise<Buffer>): Promise<Buffer> {
    this.pruneExpired();
    const cached = this.entries.get(key);
    if (cached) {
      cached.lastUsedAt = this.now();
      this.metrics.hits += 1;
      return cached.value;
    }

    const loading = this.inFlight.get(key);
    if (loading) {
      this.metrics.hits += 1;
      return loading;
    }

    this.metrics.misses += 1;
    const promise = loader().then((value) => {
      this.metrics.downloads += 1;
      this.put(key, value);
      return value;
    }).finally(() => this.inFlight.delete(key));
    this.inFlight.set(key, promise);
    return promise;
  }

  snapshot(): MediaCacheMetrics { return { ...this.metrics, bytes: this.metrics.bytes, entries: this.entries.size }; }

  private put(key: string, value: Buffer) {
    const bytes = value.byteLength;
    if (bytes > this.maxBytes) return;
    this.evictUntilFits(bytes);
    this.entries.set(key, { value, bytes, lastUsedAt: this.now() });
    this.metrics.bytes += bytes;
  }

  private pruneExpired() {
    const cutoff = this.now() - this.ttlMs;
    for (const [key, entry] of this.entries) if (entry.lastUsedAt < cutoff) this.remove(key, entry);
  }

  private evictUntilFits(required: number) {
    while (this.metrics.bytes + required > this.maxBytes && this.entries.size) {
      const oldest = [...this.entries.entries()].sort((a, b) => a[1].lastUsedAt - b[1].lastUsedAt)[0];
      this.remove(oldest[0], oldest[1]);
    }
  }

  private remove(key: string, entry: CacheEntry) {
    this.entries.delete(key);
    this.metrics.bytes -= entry.bytes;
    this.metrics.evictions += 1;
  }
}
