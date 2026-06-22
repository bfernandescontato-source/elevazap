export type EnvioStatus = "pendente" | "enfileirado" | "processando" | "sucesso" | "erro" | "pausado" | "cancelado" | "incerto";

export function canMoveToProcessing(row: { status: EnvioStatus; claim_token?: string | null }, claimToken: string) {
  return row.status === "enfileirado" && Boolean(row.claim_token) && row.claim_token === claimToken;
}

export function recoverStuckStatus(row: { status: EnvioStatus; claimed_at?: string | null; started_at?: string | null }, now = Date.now()) {
  if (row.status === "processando" && row.started_at && now - new Date(row.started_at).getTime() > 5 * 60 * 1000) return "incerto";
  if (row.status === "enfileirado" && row.claimed_at && now - new Date(row.claimed_at).getTime() > 15 * 60 * 1000) return "pendente";
  return row.status;
}

export function nextQueueKind(hasWelcome: boolean, hasGroup: boolean) {
  if (hasWelcome) return "envio";
  if (hasGroup) return "grupo";
  return null;
}

export function shouldAutoRetry(status: EnvioStatus) {
  return status !== "incerto";
}
