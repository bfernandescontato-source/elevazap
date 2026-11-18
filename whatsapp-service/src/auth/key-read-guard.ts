/**
 * Leitura das chaves Signal no banco (18/11/2026: 56 quedas em 8 dias).
 *
 * O Supabase às vezes responde com a página HTML 521/522 da Cloudflare ou
 * demora mais que DB_TIMEOUT_MS. A leitura antiga só repetia mensagens com
 * "timeout"/"network" e repassava o resto. O Baileys lê chaves dentro de
 * tarefas que ninguém aguarda (pedido de reenvio em messages-recv), então a
 * rejeição chegava ao guarda global e derrubava o processo com todos os números.
 *
 * Regras daqui:
 * - falha temporária é repetida poucas vezes, com espera crescente e dentro de
 *   um orçamento menor que SEND_TIMEOUT_MS;
 * - esgotadas as tentativas, a falha vira AuthKeysUnavailableError: nunca
 *   "chave ausente", nunca apaga credenciais nem pede QR;
 * - o número afetado entra em recuperação (socket fechado e reconexão com
 *   espera crescente) e, durante a espera, leituras dele falham na hora sem
 *   ir ao banco. Os outros números não são tocados.
 */

export const AUTH_KEYS_UNAVAILABLE = "AUTH_KEYS_UNAVAILABLE";

export const KEY_READ_POLICY = {
  maxAttempts: 4,
  baseDelayMs: 1_000,
  // Uma leitura não começa nova tentativa depois disto: cabe no SEND_TIMEOUT_MS
  // (30 s) mesmo com DB_TIMEOUT_MS de 10 s por tentativa.
  budgetMs: 20_000,
  cooldownBaseMs: 15_000,
  cooldownMaxMs: 120_000
};

export class AuthKeysUnavailableError extends Error {
  readonly code = AUTH_KEYS_UNAVAILABLE;
  /** true quando a sessão dona da leitura já foi colocada em recuperação. */
  recoveryRequested = false;

  constructor(
    readonly sessionName: string,
    readonly attempts: number,
    readonly cooldownMs: number,
    options?: { cause?: unknown }
  ) {
    super(`auth.keys.get:${sessionName}: leitura das chaves indisponível após ${attempts} tentativa(s); número em recuperação.`, options);
    this.name = "AuthKeysUnavailableError";
  }
}

export function isAuthKeysUnavailableError(error: unknown): error is AuthKeysUnavailableError {
  return Boolean(error && typeof error === "object" && (error as { code?: unknown }).code === AUTH_KEYS_UNAVAILABLE);
}

const TEMPORARY_MESSAGE = /fetch failed|network|econnreset|enotfound|econnrefused|etimedout|socket hang up|excedeu o limite|timeout|timed out/i;
// Página de erro da Cloudflare/gateway na frente do Supabase (o supabase-js
// põe o corpo HTML na mensagem do erro).
const GATEWAY_PAGE = /error code:? *5(0[234]|2[0-9])\b|cf-error-details|web server is down|bad gateway|service unavailable|gateway time-?out|<!doctype html|<html/i;

/** Falha de infraestrutura que pode passar sozinha. 400 (chave malformada) não entra. */
export function isTemporaryKeyReadError(error: unknown) {
  const current = error as { message?: string; code?: string; status?: number } | null;
  if (!current) return false;
  if (current.code === "OPERATION_TIMEOUT") return true;
  if (typeof current.status === "number" && current.status >= 500) return true;
  const message = String(current.message || "");
  return TEMPORARY_MESSAGE.test(message) || GATEWAY_PAGE.test(message);
}

/** Espera antes da tentativa seguinte: 1 s, 2 s, 4 s, com ±25% para não sincronizar números. */
export function keyReadRetryDelay(attempt: number, random = Math.random) {
  const base = KEY_READ_POLICY.baseDelayMs * 2 ** (attempt - 1);
  return Math.round(base * (0.75 + random() * 0.5));
}

/** Espera do número em recuperação: 15 s, 30 s, 60 s, 120 s (teto). */
export function keyOutageCooldown(consecutiveOutages: number) {
  return Math.min(KEY_READ_POLICY.cooldownMaxMs, KEY_READ_POLICY.cooldownBaseMs * 2 ** Math.max(0, consecutiveOutages - 1));
}
