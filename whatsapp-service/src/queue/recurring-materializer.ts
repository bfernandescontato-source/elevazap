import { supabase } from "../supabase.js";
import { isMissingRpc } from "./policy.js";

// Mensagens automáticas: cria os lotes de hoje e amanhã das mensagens que ainda
// não foram materializadas. Só chama o banco (nada de WhatsApp aqui). Cada
// chamada processa poucas mensagens para ficar bem abaixo do limite de 8 s; o
// banco garante que a mesma ocorrência nunca vira dois lotes.

const RPC = "materialize_due_recurring_group_messages";
const PER_CALL = 3;
const MAX_CALLS_PER_TICK = 30;

type RpcClient = { rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: any }> };

export class RecurringMessageMaterializer {
  private running = false;
  private unavailable = false;

  constructor(private readonly client: RpcClient = supabase as unknown as RpcClient) {}

  /** Devolve quantas mensagens foram processadas neste ciclo. */
  async tick(): Promise<number> {
    if (this.running || this.unavailable) return 0;
    this.running = true;
    let processed = 0;
    try {
      for (let call = 0; call < MAX_CALLS_PER_TICK; call += 1) {
        const { data, error } = await this.client.rpc(RPC, { p_limit: PER_CALL });
        if (error) {
          if (isMissingRpc(error, RPC)) {
            // Migration ainda não aplicada: para de tentar até o próximo boot.
            this.unavailable = true;
            console.info({ event: "recurring_messages.unavailable", component: "recurring-messages" });
            return processed;
          }
          throw error;
        }
        const count = Number(data || 0);
        processed += count;
        if (count < PER_CALL) break;
      }
      if (processed) console.info({ event: "recurring_messages.materialized", component: "recurring-messages", processed });
      return processed;
    } finally {
      this.running = false;
    }
  }
}
