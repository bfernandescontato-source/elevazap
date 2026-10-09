import { readFileSync, statSync } from "node:fs";

/**
 * Espera local de números (contenção de emergência, 09/10/2026).
 *
 * Arquivo com um session_name por linha, dentro do container (sobrevive a `docker restart`,
 * some num redeploy). Um vigia externo grava aqui com `docker exec` mesmo com o processo travado
 * ou o banco fora; o serviço não carrega e para os números listados, sem depender do banco.
 * A pausa operacional "de verdade" fica no banco (whatsapp_sender_pauses).
 */
export const LOCAL_HOLD_FILE = process.env.LOCAL_HOLD_FILE || "/tmp/disparei-hold-sessions";

let cache: { mtimeMs: number; names: Set<string> } | null = null;

export function locallyHeldSessions(file = LOCAL_HOLD_FILE): Set<string> {
  try {
    const { mtimeMs } = statSync(file);
    if (cache && cache.mtimeMs === mtimeMs) return cache.names;
    const names = new Set(readFileSync(file, "utf8").split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith("#")));
    cache = { mtimeMs, names };
    return names;
  } catch {
    cache = null;
    return new Set();
  }
}

export function isLocallyHeld(sessionName: string, file = LOCAL_HOLD_FILE) {
  return locallyHeldSessions(file).has(sessionName);
}
