type KeyStore = {
  get: (type: string, ids: string[]) => Promise<Record<string, any>>;
  set: (data: any) => Promise<void>;
  clear?: () => Promise<void>;
};
type Read = { ids: string[]; resolve: (rows: Record<string, any>) => void; reject: (error: unknown) => void };

/** Coalesce concurrent cold Signal reads before the ordered database lock.
 * A group can require thousands of new device sessions. Libsignal loads each
 * separately, including absent sessions which Baileys does not cache. Writing
 * remains ordered: flush earlier reads before queuing a write or clear barrier.
 */
export function batchKeyStore(store: KeyStore): KeyStore {
  let pending = new Map<string, Read[]>();
  let scheduled = false;
  const flush = () => {
    scheduled = false;
    const batch = pending;
    pending = new Map();
    for (const [type, reads] of batch) {
      const ids = [...new Set(reads.flatMap((read) => read.ids))];
      // Calling get synchronously reserves its place in the auth operation lock.
      void store.get(type, ids).then((rows) => {
        for (const read of reads) {
          const result: Record<string, any> = {};
          for (const id of read.ids) if (Object.hasOwn(rows, id)) result[id] = rows[id];
          read.resolve(result);
        }
      }, (error) => { for (const read of reads) read.reject(error); });
    }
  };
  return {
    get: (type, ids) => new Promise((resolve, reject) => {
      const reads = pending.get(type) || [];
      reads.push({ ids, resolve, reject });
      pending.set(type, reads);
      if (!scheduled) { scheduled = true; queueMicrotask(flush); }
    }),
    set: (data) => { flush(); return store.set(data); },
    clear: () => { flush(); return store.clear?.() || Promise.resolve(); }
  };
}
