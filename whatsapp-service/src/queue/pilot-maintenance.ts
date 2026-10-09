import { errorFields } from "../utils/log.js";
import { isMissingRpc } from "./policy.js";

// Trabalhador da reorganização do Piloto (migration 20261010000000). Os envios, falhas, cancelamentos
// e capturas só registram um pedido no banco; aqui cada Piloto é reorganizado em chamada própria.
// Roda num ciclo separado da fila de envios: reorganização lenta nunca atrasa envio nem confirmação.
// O banco guarda tentativas e intervalo; este ciclo só pede, executa e registra o erro.

type Rpc = (name: string, params: Record<string, unknown>) => Promise<{ data: any; error: any }>;

export type PilotMaintenanceStats = {
  available: boolean;
  running: boolean;
  done: number;
  busy: number;
  failed: number;
  lastError: string | null;
  lastRunAt: string | null;
};

export class PilotMaintenanceWorker {
  private running = false;
  private wake: (() => void) | null = null;
  private counters = { done: 0, busy: 0, failed: 0 };
  private lastError: string | null = null;
  private lastRunAt: string | null = null;
  private available = true;

  constructor(
    private rpc: Rpc,
    private workerId: string,
    private options: { idleMs?: number; batch?: number; sleep?: (ms: number) => Promise<void> } = {}
  ) {}

  start() {
    if (this.running) return;
    this.running = true;
    void this.loop();
  }

  stop() {
    this.running = false;
    this.kick();
  }

  // Acorda o ciclo logo depois de uma confirmação (não espera o intervalo ocioso).
  kick() {
    const wake = this.wake;
    this.wake = null;
    wake?.();
  }

  stats(): PilotMaintenanceStats {
    return { available: this.available, running: this.running, ...this.counters, lastError: this.lastError, lastRunAt: this.lastRunAt };
  }

  async runOnce() {
    const claimed = await this.rpc("claim_pilot_maintenance", { p_worker_id: this.workerId, p_limit: this.options.batch ?? 5 });
    if (claimed.error) {
      if (isMissingRpc(claimed.error, "claim_pilot_maintenance")) this.available = false;
      throw Object.assign(new Error(`pilot-maintenance.claim: ${claimed.error.message}`), { code: claimed.error.code });
    }
    const jobs = (claimed.data || []) as Array<{ automation_id: string; attempts: number }>;
    for (const job of jobs) {
      const result = await this.rpc("run_pilot_maintenance", { p_automation_id: job.automation_id });
      this.lastRunAt = new Date().toISOString();
      if (result.error) {
        this.counters.failed++;
        this.lastError = result.error.message || String(result.error.code);
        console.error({ event: "pilot_maintenance.failed", component: "pilot-maintenance", automation_id: job.automation_id,
          attempts: job.attempts, errorCode: result.error.code, errorMessage: result.error.message });
        await this.rpc("fail_pilot_maintenance", { p_automation_id: job.automation_id, p_error: this.lastError }).catch(() => undefined);
        continue;
      }
      if (result.data === "ocupado") this.counters.busy++;
      else this.counters.done++;
    }
    return jobs.length;
  }

  private async loop() {
    const sleep = this.options.sleep ?? ((ms: number) => new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, ms);
      this.wake = () => { clearTimeout(timer); resolve(); };
    }));
    while (this.running && this.available) {
      let handled = 0;
      try {
        handled = await this.runOnce();
      } catch (error) {
        this.lastError = error instanceof Error ? error.message : String(error);
        if (this.available) console.error({ event: "pilot_maintenance.loop_failed", component: "pilot-maintenance", ...errorFields(error) });
      }
      await sleep(handled ? 50 : this.options.idleMs ?? 2_000);
    }
  }
}
