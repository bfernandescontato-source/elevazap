/**
 * Últimas mensagens ENVIADAS por um número, para atender o pedido de reenvio do
 * WhatsApp (retry receipt) via `getMessage` do Baileys.
 *
 * Sem isso o Baileys nunca acha a mensagem original: o reenvio legítimo (um
 * aparelho do grupo que não conseguiu decifrar) não acontece. A loja é por
 * número (uma instância por sessão), limitada em quantidade e em idade, e só
 * vive em memória: depois de um reinício o pedido de uma mensagem antiga fica
 * sem resposta, e a correção do Baileys (scripts/patch-baileys-retry.mjs)
 * garante que isso não cria sessão Signal nova.
 */
export const SENT_STORE_MAX = 500;
export const SENT_STORE_TTL_MS = 60 * 60_000;

type Entry = { remoteJid: string; message: unknown; at: number };

export function createSentMessageStore(options: { max?: number; ttlMs?: number; now?: () => number } = {}) {
  const max = options.max ?? SENT_STORE_MAX;
  const ttlMs = options.ttlMs ?? SENT_STORE_TTL_MS;
  const now = options.now ?? Date.now;
  const entries = new Map<string, Entry>();

  function prune() {
    const limit = now() - ttlMs;
    for (const [id, entry] of entries) {
      if (entries.size > max || entry.at < limit) entries.delete(id);
      else break; // Map mantém a ordem de inserção: o resto é mais novo
    }
  }

  return {
    /** Guarda mensagens próprias (fromMe) com conteúdo. Ignora o resto. */
    remember(messages: any[]) {
      for (const msg of messages || []) {
        const id = msg?.key?.id;
        if (!id || !msg.key.fromMe || !msg.message || !msg.key.remoteJid) continue;
        entries.delete(id);
        entries.set(id, { remoteJid: msg.key.remoteJid, message: msg.message, at: now() });
      }
      prune();
    },
    /** Só devolve se a conversa (grupo ou contato) também bater com a da mensagem guardada. */
    get(key: { id?: string | null; remoteJid?: string | null }) {
      prune();
      const entry = key?.id ? entries.get(key.id) : undefined;
      if (!entry || (key.remoteJid && key.remoteJid !== entry.remoteJid)) return undefined;
      return entry.message;
    },
    size: () => entries.size
  };
}

export type SentMessageStore = ReturnType<typeof createSentMessageStore>;
