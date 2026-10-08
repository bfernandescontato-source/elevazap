/**
 * Número "conectado mas surdo" (Rosi, Simone, Jacqueline...): ao reconectar,
 * o WhatsApp avisa que há mensagens pendentes (offline_preview) e o Baileys
 * 6.7.23 pede UM lote de 100 (offline_batch). O Baileys segura todos os
 * eventos (ev.buffer) até o servidor confirmar o fim das pendentes
 * ("ib,,offline"). Quem acumulou mais de 100 mensagens (muitos grupos ativos)
 * recebe só o primeiro lote, o próximo nunca é pedido, o fim nunca chega e
 * nenhum messages.upsert sai do buffer: o Piloto não vê nada. Ler QR "resolve"
 * só porque zera as pendentes, até a próxima queda.
 *
 * Observado em 08/10: os dois números receberam 105 mensagens no 1º segundo
 * após abrir e mais nada por 13 min, com ev.isBuffering() = true o tempo todo.
 *
 * Enquanto o socket estiver em buffer depois de aberto, pedimos o próximo lote
 * a cada intervalo e, passado o limite, forçamos o flush para o Piloto voltar
 * a receber mesmo se o servidor não confirmar.
 */
export const OFFLINE_BATCH_INTERVAL_MS = 10_000;
export const OFFLINE_FORCE_FLUSH_MS = 60_000;
// Teto de segurança: uma conexão viva não deveria ficar mais que isso puxando pendentes.
const MAX_GUARD_MS = 2 * 60 * 60_000;

type Log = (event: string, fields?: Record<string, unknown>) => void;

export function guardOfflineBuffer(sock: any, log: Log, now: () => number = Date.now) {
  const openedAt = now();
  let batchesRequested = 0;
  let flushes = 0;
  let lastFlushAt = openedAt;
  // Fim das pendentes confirmado pelo servidor ("ib,,offline"). Em 08/10 o
  // flush forçado liberava o buffer, a guarda parava de pedir lotes e o
  // servidor seguia guardando as mensagens novas como pendentes: a Rosi ficou
  // conectada recebendo 1 mensagem em 20 min. Só o fim confirmado encerra.
  let serverDone = false;
  const onUpdate = (update: any) => { if (update?.receivedPendingNotifications === true) serverDone = true; };
  sock?.ev?.on?.("connection.update", onUpdate);
  const stop = () => {
    clearInterval(timer);
    sock?.ev?.off?.("connection.update", onUpdate);
  };
  const timer = setInterval(() => {
    const elapsed = now() - openedAt;
    const buffering = typeof sock?.ev?.isBuffering === "function" && sock.ev.isBuffering();
    if (!sock?.ws?.isOpen || elapsed > MAX_GUARD_MS) {
      if (batchesRequested) log("whatsapp.offline_guard_stopped", { elapsed_ms: elapsed, batches_requested: batchesRequested, forced_flushes: flushes, server_done: serverDone });
      stop();
      return;
    }
    // Número saudável: o buffer já liberou sozinho antes de qualquer pedido.
    // Número travado: depois de começar a pedir, só para com o fim confirmado.
    if (!buffering && (serverDone || !batchesRequested)) {
      if (batchesRequested) log("whatsapp.offline_buffer_released", { elapsed_ms: elapsed, batches_requested: batchesRequested, forced_flushes: flushes, server_done: serverDone });
      stop();
      return;
    }
    // Se o Baileys voltar a segurar depois do flush, força de novo a cada limite.
    if (buffering && now() - lastFlushAt >= OFFLINE_FORCE_FLUSH_MS) {
      flushes++;
      lastFlushAt = now();
      log("whatsapp.offline_buffer_forced_flush", { elapsed_ms: elapsed, batches_requested: batchesRequested, flushes });
      try { sock.ev.flush(); } catch (error) { log("whatsapp.offline_buffer_flush_failed", { message: String((error as Error)?.message || error) }); }
      return;
    }
    if (serverDone) return;
    batchesRequested++;
    Promise.resolve()
      .then(() => sock.sendNode({ tag: "ib", attrs: {}, content: [{ tag: "offline_batch", attrs: { count: "100" } }] }))
      .catch((error: unknown) => log("whatsapp.offline_batch_request_failed", { message: String((error as Error)?.message || error) }));
  }, OFFLINE_BATCH_INTERVAL_MS);
  timer.unref?.();
  return stop;
}
