const POLL_MS = 30_000;

// Único gatilho para disparos 1x1 agendados (WhatsApp Oficial): nada observa a tabela
// official_broadcasts além deste poller, então sem ele um disparo "scheduled" nunca sai do lugar.
// Chama a própria API (mesmo padrão de triggerBatchProcessing) em vez de importar o módulo do
// disparo diretamente — o bundler de instrumentation.ts compila para o runtime edge também, e o
// módulo de disparos puxa código com `import ... from "crypto"` que não resolve nesse contexto.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const flagged = globalThis as unknown as { __officialBroadcastSchedulerStarted__?: boolean };
  if (flagged.__officialBroadcastSchedulerStarted__) return;
  flagged.__officialBroadcastSchedulerStarted__ = true;

  const { appUrl, env } = await import("@/lib/env");

  setInterval(() => {
    fetch(`${appUrl()}/api/admin/official/broadcasts/run-scheduled`, {
      method: "POST",
      headers: { "x-internal-api-key": env().INTERNAL_API_KEY }
    }).catch((error) => console.error("[official-broadcast] falha ao verificar disparos agendados:", error));
  }, POLL_MS);
}
