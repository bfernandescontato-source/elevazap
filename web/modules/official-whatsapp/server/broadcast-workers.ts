/** Um trabalhador livre pega o próximo contato sem esperar os demais. */
export async function runBroadcastWorkers<T>(items: T[], concurrency: number, canStart: () => Promise<boolean>, send: (item: T) => Promise<void>) {
  let cursor = 0;
  let stopped = false;
  const started = new Set<T>();
  const workers = Array.from({ length: Math.min(items.length, Math.max(1, Math.trunc(concurrency))) }, async () => {
    try {
      while (!stopped && cursor < items.length) {
        if (!await canStart() || stopped) { stopped = true; return; }
        // Sem await entre selecionar e registrar: cada item pertence a um trabalhador.
        if (cursor >= items.length) return;
        const item = items[cursor++];
        started.add(item);
        await send(item);
      }
    } catch (error) { stopped = true; throw error; }
  });
  // Mesmo em falha, aguarda os envios em voo antes de propagar o erro.
  const settled = await Promise.allSettled(workers);
  const failure = settled.find((result) => result.status === "rejected");
  if (failure?.status === "rejected") throw failure.reason;
  return items.filter((item) => !started.has(item));
}
