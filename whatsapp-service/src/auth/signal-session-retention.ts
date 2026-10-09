/**
 * Retenção do registro de sessões Signal (key_type 'session'), igual à da libsignal.
 *
 * A libsignal só limpa o registro (`SessionRecord.removeOldSessions`, até 40 sessões,
 * apagando primeiro as FECHADAS mais antigas) quando decifra com sucesso. O caminho que
 * CRIA sessão (`SessionBuilder.initOutgoing`) grava sem limpar. Com pedidos de reenvio
 * repetidos o registro chegou a centenas de sessões fechadas, e toda mensagem que falha
 * é testada contra cada uma delas (CPU presa por mais de 1 minuto).
 *
 * Aqui a mesma regra vale na leitura e na gravação do banco. A sessão aberta nunca sai;
 * só saem as fechadas mais antigas, exatamente as que a libsignal apagaria no próximo
 * sucesso. Registro sem sessão fechada para remover fica como está (a libsignal lançaria
 * "Corrupt sessions object"; aqui não mexemos).
 */
export const SIGNAL_SESSIONS_MAX = 40;

type SessionRecordData = { _sessions?: Record<string, { indexInfo?: { closed?: number } }>; version?: unknown };

export function trimSessionRecord<T>(data: T, max = SIGNAL_SESSIONS_MAX): { data: T; removed: number } {
  const record = data as SessionRecordData;
  const sessions = record?._sessions;
  if (!sessions || typeof sessions !== "object") return { data, removed: 0 };
  const keys = Object.keys(sessions);
  if (keys.length <= max) return { data, removed: 0 };

  const closed = keys
    .map((key, order) => ({ key, order, closedAt: sessions[key]?.indexInfo?.closed }))
    .filter((item) => typeof item.closedAt === "number" && item.closedAt !== -1)
    .sort((a, b) => (a.closedAt as number) - (b.closedAt as number) || a.order - b.order);
  const excess = Math.min(keys.length - max, closed.length);
  if (excess <= 0) return { data, removed: 0 };

  const drop = new Set(closed.slice(0, excess).map((item) => item.key));
  const kept: Record<string, unknown> = {};
  for (const key of keys) if (!drop.has(key)) kept[key] = sessions[key];
  return { data: { ...record, _sessions: kept } as T, removed: excess };
}
