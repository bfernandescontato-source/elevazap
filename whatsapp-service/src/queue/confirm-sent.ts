import { OperationTimeoutError } from "../utils/timeout.js";

// Confirmação de uma mensagem que o WhatsApp JÁ aceitou. Aqui só se repete a GRAVAÇÃO da
// confirmação no banco; a mensagem nunca é reenviada. Repetir é seguro: a função do banco só
// grava com a mesma ficha (claim_token) e a limpa ao gravar, então uma segunda gravação devolve
// false e a releitura mostra se a primeira já tinha sido salva (resposta perdida no caminho).

export type ConfirmRow = { status: string | null; wa_message_id: string | null } | null;

export type ConfirmDeps = {
  complete: () => Promise<boolean>;
  readBack: () => Promise<ConfirmRow>;
  sleep: (ms: number) => Promise<unknown>;
};

export type ConfirmOutcome =
  | { state: "confirmed" | "already_confirmed"; attempts: number }
  | { state: "unconfirmed"; attempts: number; cause: unknown };

// Erros em que a gravação pode dar certo numa nova tentativa: tempo esgotado no banco, conflito
// de transação, trava indisponível, conexão, PostgREST sem banco, ou tempo esgotado no cliente.
const TRANSIENT_CODES = new Set(["57014", "40001", "40P01", "55P03", "53300", "PGRST000", "PGRST001", "PGRST002", "PGRST003", "DATABASE_ERROR"]);

export function isTransientDbError(error: unknown) {
  if (error instanceof OperationTimeoutError) return true;
  const code = String((error as any)?.code || "");
  return TRANSIENT_CODES.has(code) || code.startsWith("08");
}

function savedAsSent(row: ConfirmRow, messageId: string) {
  return row?.status === "sucesso" && row.wa_message_id === messageId;
}

export async function confirmSent(messageId: string, deps: ConfirmDeps, delaysMs: number[] = [500, 2_000]): Promise<ConfirmOutcome> {
  const attempts = delaysMs.length + 1;
  let cause: unknown = new Error("Confirmação não gravada.");
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      if (await deps.complete()) return { state: "confirmed", attempts: attempt };
      // false: a ficha não vale mais. Ou uma tentativa anterior gravou (resposta perdida), ou o
      // trabalhador perdeu o direito sobre o envio. Só a releitura distingue; não repete.
      const row = await deps.readBack();
      if (savedAsSent(row, messageId)) return { state: "already_confirmed", attempts: attempt };
      return { state: "unconfirmed", attempts: attempt, cause: new Error("Fencing token expirou antes da confirmação do envio.") };
    } catch (error) {
      cause = error;
      // O banco pode ter gravado mesmo com erro na resposta: confere antes de repetir.
      try {
        if (savedAsSent(await deps.readBack(), messageId)) return { state: "already_confirmed", attempts: attempt };
      } catch { /* releitura também falhou: decide pela natureza do erro */ }
      if (!isTransientDbError(error) || attempt === attempts) break;
      await deps.sleep(delaysMs[attempt - 1]);
    }
  }
  return { state: "unconfirmed", attempts, cause };
}
