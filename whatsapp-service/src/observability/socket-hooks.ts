import { observer } from "./observer.js";

/**
 * Ouvintes de observação nos sockets do Baileys, ligáveis em tempo de execução.
 *
 * Cada instância de sessão (createWhatsAppSession) cria um controle aqui. O
 * conjunto `liveInstances` é só contabilidade passiva (nenhum ouvinte): ele
 * existe para que, ao ligar a observação ou mudar o canary, os sockets já
 * abertos — inclusive de instâncias que saíram do mapa `senders` sem parar —
 * passem a ser observados, e para que ao desligar todos os ouvintes saiam.
 *
 * Os ouvintes só leem: `frame` (stanza decodificada, antes do Signal) e
 * `message` (bytes recebidos). Erros são engolidos para nunca chegarem ao
 * `emit` do Baileys.
 */

type WsLike = {
  on?: (event: string, listener: (...args: any[]) => void) => unknown;
  off?: (event: string, listener: (...args: any[]) => void) => unknown;
  isOpen?: boolean;
};
type SocketLike = { ws?: WsLike | null } | null | undefined;

type Attached = { ws: WsLike; seq: number; onFrame: (frame: any) => void; onBytes: (data: any) => void };

function safe(action: () => void) {
  try { action(); } catch { /* observabilidade nunca interfere no socket */ }
}

export class InstanceHooks {
  private sock: SocketLike = null;
  private seq = 0;
  private attached: Attached | null = null;
  private registered = false;
  private released = false;

  constructor(
    readonly sessionName: string,
    readonly instanceId: string,
    private readonly accountId: string | null | undefined,
    private readonly probe: () => Record<string, unknown>
  ) {}

  /** Chamado a cada socket novo criado por esta instância. */
  socketCreated(sock: SocketLike, seq: number) {
    if (this.released) return;
    this.detachListeners();
    this.sock = sock;
    this.seq = seq;
    if (observer.isActive(this.sessionName)) {
      this.register();
      observer.socketCreated(this.sessionName, this.instanceId, seq, this.accountId);
      this.attachListeners();
    }
  }

  /** Aplica a configuração atual (ligado/desligado, canary) a esta instância. */
  sync() {
    if (this.released) return;
    const active = observer.isActive(this.sessionName);
    if (active && !this.attached) {
      this.register();
      if (this.sock?.ws) {
        observer.socketCreated(this.sessionName, this.instanceId, this.seq, this.accountId);
        if (this.sock.ws.isOpen) observer.socketOpened(this.sessionName, this.instanceId, this.seq);
        this.attachListeners();
      }
    } else if (!active && (this.attached || this.registered)) {
      this.detachListeners();
      this.unregister("obs_disabled");
    }
  }

  release(reason: string) {
    if (this.released) return;
    this.released = true;
    this.detachListeners();
    this.unregister(reason);
    liveInstances.delete(this);
  }

  listenerCount() {
    return this.attached ? 2 : 0;
  }

  private register() {
    if (this.registered) return;
    this.registered = true;
    observer.registerInstance(this.sessionName, this.instanceId, this.probe, this.accountId);
  }

  private unregister(reason: string) {
    if (!this.registered) return;
    this.registered = false;
    observer.unregisterInstance(this.sessionName, this.instanceId, reason);
  }

  private attachListeners() {
    const ws = this.sock?.ws;
    if (!ws?.on || this.attached) return;
    const sessionName = this.sessionName;
    const instanceId = this.instanceId;
    const seq = this.seq;
    const onFrame = (frame: any) => safe(() => observer.frame(sessionName, frame, instanceId, seq));
    const onBytes = (data: any) => safe(() => observer.count(sessionName, "raw_bytes", data?.length || data?.byteLength || 0));
    ws.on("frame", onFrame);
    ws.on("message", onBytes);
    this.attached = { ws, seq, onFrame, onBytes };
  }

  private detachListeners() {
    if (!this.attached) return;
    const { ws, onFrame, onBytes } = this.attached;
    safe(() => { ws.off?.("frame", onFrame); ws.off?.("message", onBytes); });
    this.attached = null;
  }
}

const liveInstances = new Set<InstanceHooks>();

export function createInstanceHooks(sessionName: string, instanceId: string, accountId: string | null | undefined, probe: () => Record<string, unknown>) {
  const hooks = new InstanceHooks(sessionName, instanceId, accountId, probe);
  liveInstances.add(hooks);
  return hooks;
}

/** Total de ouvintes de observação registrados agora (0 quando desligado). */
export function observabilityListenerCount() {
  let total = 0;
  for (const hooks of liveInstances) total += hooks.listenerCount();
  return total;
}

export function liveInstanceCount() {
  return liveInstances.size;
}

observer.onConfigChange(() => {
  for (const hooks of liveInstances) safe(() => hooks.sync());
});
