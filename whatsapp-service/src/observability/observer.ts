import { randomUUID } from "crypto";

/**
 * Observabilidade do whatsapp-service (investigação do "número surdo").
 *
 * Só observa. Nada aqui muda conexão, fila, envio, chaves ou reconexão, e a
 * telemetria registra apenas o que foi observado; interpretação fica fora dela.
 *
 * - Liga/desliga em tempo de execução (`configure`). Desligado: nenhum
 *   contador é tocado e os hooks externos (ouvintes de socket, timers,
 *   monitor de crash) são removidos por quem os registrou.
 * - Canary: com uma lista de números, só eles são instrumentados; o processo
 *   (supervisor, event loop) é sempre global enquanto ligado.
 * - Contadores por minuto num ring buffer em memória, gravados em lote.
 * - Cada socket é identificado por session_instance_id + socket_seq, e seus
 *   eventos ficam separados: duas instâncias vivas do mesmo número não se somam.
 */

export const PROCESS_SESSION = "__process__";
export const CHECKPOINT_MINUTES = [2, 5, 10, 20] as const;
/** Houve stanza `message` crua desde o último upsert recebido (fromMe=false). */
export const RAW_SEEN_NO_INBOUND_UPSERT = "RAW_SEEN_NO_INBOUND_UPSERT";
/** Nenhuma stanza `message` crua desde o último upsert recebido. */
export const NO_RAW_NO_INBOUND_UPSERT = "NO_RAW_NO_INBOUND_UPSERT";

const INCIDENT_LEVEL = 20;
const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const MAX_EVENTS_PER_SESSION = 500;
const MAX_SNAPSHOT_EVENTS = 200;
const MAX_INCIDENTS_IN_MEMORY = 50;
const MAX_SOCKET_STATS_PER_SESSION = 20;
const CRASH_DUMP_MINUTES = 15;
const CRASH_DUMP_EVENTS = 50;

export type Counters = Record<string, number>;
export type MinuteBucket = { minute: number; c: Counters; mx: Counters; s: Record<string, Counters>; flushed: boolean };
export type ObsEvent = { at: number; type: string; [key: string]: unknown };

export type MinuteRow = {
  session_name: string;
  account_id: string | null;
  minute: string;
  data: { c: Counters; mx: Counters; s?: Record<string, Counters> };
};

export type IncidentRow = {
  id: string;
  incident_id: string;
  session_name: string;
  account_id: string | null;
  kind: string;
  reason: string;
  level_minutes: number;
  classification: string;
  detected_at: string;
  resolved_at?: string | null;
  silence_ms?: number | null;
  snapshot: Record<string, unknown>;
};

export type ObsPersistence = {
  writeMinutes(rows: MinuteRow[]): Promise<void>;
  writeIncident(row: IncidentRow): Promise<void>;
  resolveIncident(incidentId: string, resolvedAt: string, silenceMs: number): Promise<void>;
};

type SocketStats = {
  key: string;
  instanceId: string;
  seq: number;
  createdAt: number;
  openedAt: number | null;
  closedAt: number | null;
  closeCode: number | null;
  frames: number;
  rawMessage: number;
  rawGroupMessage: number;
  inboundMsgs: number;
  upsertEvents: number;
  lastRaw: number | null;
  lastInbound: number | null;
};

type SessionState = {
  sessionName: string;
  accountId: string | null;
  ring: MinuteBucket[];
  events: ObsEvent[];
  last: Record<string, number>;
  rawSinceInbound: number;
  rawSinceAnyUpsert: number;
  sockets: Map<string, SocketStats>;
  probes: Map<string, () => Record<string, unknown>>;
  level: number;
  incidentId: string | null;
  silenceSince: number | null;
  lastPreRestartWrite: number;
  lastSocketSeq: number;
  lastSocketInstance: string;
  lastSocketKey: string;
};

export type IncidentLimits = {
  preRestartPerMinute: number;
  perHour: number;
  preRestartMinIntervalPerSessionMs: number;
  snapshotMinutes: number;
};

export type ObserverOptions = {
  now?: () => number;
  ringMinutes?: number;
  persistence?: ObsPersistence | null;
  log?: (entry: Record<string, unknown>) => void;
  enabled?: boolean;
  sessions?: string[] | null;
  limits?: Partial<IncidentLimits>;
};

export type ObsConfig = { enabled: boolean; sessions: string[] | null };

export function socketKey(instanceId: string, seq: number) {
  return `${instanceId.slice(0, 8)}#${seq}`;
}

export function classifyDecryptError(text: string | undefined | null) {
  const value = String(text || "");
  if (/bad mac/i.test(value)) return "bad_mac";
  if (/2000 messages into the future/i.test(value)) return "over2000";
  if (/key used already|never filled|MessageCounterError/i.test(value)) return "counter";
  if (/no senderkeyrecord|sender ?key/i.test(value)) return "no_senderkey";
  if (/no session|no matching sessions|no open session/i.test(value)) return "no_session";
  if (/missing keys|message absent/i.test(value)) return "missing_keys";
  return "other";
}

export function parseSessionList(value: string | null | undefined): string[] | null {
  const list = String(value || "").split(",").map((item) => item.trim()).filter(Boolean);
  return list.length ? list : null;
}

export class SessionObserver {
  private readonly sessions = new Map<string, SessionState>();
  private readonly managed = new Map<string, string | null>();
  private readonly incidents: IncidentRow[] = [];
  private readonly globalProbes = new Map<string, (sessionName: string) => unknown>();
  private readonly configListeners = new Set<(config: ObsConfig) => void>();
  private readonly now: () => number;
  private readonly ringMinutes: number;
  private readonly limits: IncidentLimits;
  private persistence: ObsPersistence | null;
  private readonly log: (entry: Record<string, unknown>) => void;
  private enabled: boolean;
  private allow: Set<string> | null;
  private flushing = false;
  private readonly preRestartWrites: number[] = [];
  private readonly hourWrites: number[] = [];

  constructor(options: ObserverOptions = {}) {
    this.now = options.now || Date.now;
    this.ringMinutes = options.ringMinutes || 60;
    this.persistence = options.persistence ?? null;
    this.log = options.log || ((entry) => console.info({ component: "obs", ...entry }));
    this.enabled = options.enabled ?? false;
    this.allow = options.sessions ? new Set(options.sessions) : null;
    this.limits = {
      preRestartPerMinute: options.limits?.preRestartPerMinute ?? 12,
      perHour: options.limits?.perHour ?? 30,
      preRestartMinIntervalPerSessionMs: options.limits?.preRestartMinIntervalPerSessionMs ?? 10 * MINUTE_MS,
      snapshotMinutes: options.limits?.snapshotMinutes ?? 30
    };
  }

  // ---- configuração ----------------------------------------------------------

  setPersistence(persistence: ObsPersistence | null) { this.persistence = persistence; }
  registerGlobalProbe(name: string, probe: (sessionName: string) => unknown) { this.globalProbes.set(name, probe); }

  config(): ObsConfig { return { enabled: this.enabled, sessions: this.allow ? Array.from(this.allow).sort() : null }; }
  isEnabled() { return this.enabled; }
  /** Este número está sendo instrumentado agora? O processo segue `enabled`. */
  isActive(sessionName: string) {
    if (!this.enabled) return false;
    if (sessionName === PROCESS_SESSION || !this.allow) return true;
    return this.allow.has(sessionName);
  }

  /** Quem registra hooks externos se inscreve aqui para ligar/desligar junto. */
  onConfigChange(listener: (config: ObsConfig) => void) {
    this.configListeners.add(listener);
    return () => this.configListeners.delete(listener);
  }

  configure(update: { enabled?: boolean; sessions?: string[] | null }) {
    if (update.enabled !== undefined) this.enabled = update.enabled;
    if (update.sessions !== undefined) this.allow = update.sessions && update.sessions.length ? new Set(update.sessions) : null;
    const config = this.config();
    for (const listener of this.configListeners) {
      try { listener(config); } catch (error: any) { this.log({ event: "obs.config_listener_failed", error: String(error?.message || error) }); }
    }
    this.log({ event: "obs.config", ...config });
    return config;
  }

  // ---- primitivas (todas no-op quando o número não está ativo) ---------------

  private state(sessionName: string, accountId?: string | null): SessionState {
    let state = this.sessions.get(sessionName);
    if (!state) {
      state = {
        sessionName, accountId: accountId || null, ring: [], events: [], last: {}, rawSinceInbound: 0, rawSinceAnyUpsert: 0,
        sockets: new Map(), probes: new Map(), level: 0, incidentId: null, silenceSince: null, lastPreRestartWrite: 0,
        lastSocketSeq: -1, lastSocketInstance: "", lastSocketKey: ""
      };
      this.sessions.set(sessionName, state);
    } else if (accountId && !state.accountId) {
      state.accountId = accountId;
    }
    return state;
  }

  private bucket(state: SessionState, at = this.now()): MinuteBucket {
    const minute = Math.floor(at / MINUTE_MS);
    const current = state.ring[state.ring.length - 1];
    if (current && current.minute === minute) return current;
    const created: MinuteBucket = { minute, c: {}, mx: {}, s: {}, flushed: false };
    state.ring.push(created);
    while (state.ring.length > this.ringMinutes) state.ring.shift();
    return created;
  }

  private add(counters: Counters, key: string, n: number) { counters[key] = (counters[key] || 0) + n; }

  count(sessionName: string, key: string, n = 1, accountId?: string | null) {
    if (!this.isActive(sessionName)) return;
    this.add(this.bucket(this.state(sessionName, accountId)).c, key, n);
  }

  max(sessionName: string, key: string, value: number) {
    if (!this.isActive(sessionName) || !Number.isFinite(value)) return;
    const bucket = this.bucket(this.state(sessionName));
    if (bucket.mx[key] === undefined || value > bucket.mx[key]) bucket.mx[key] = value;
  }

  mark(sessionName: string, key: string, at = this.now()) {
    if (!this.isActive(sessionName)) return;
    this.state(sessionName).last[key] = at;
  }

  event(sessionName: string, type: string, fields: Record<string, unknown> = {}) {
    if (!this.isActive(sessionName)) return;
    const state = this.state(sessionName);
    state.events.push({ at: this.now(), type, ...fields });
    if (state.events.length > MAX_EVENTS_PER_SESSION) state.events.shift();
  }

  private socketCount(state: SessionState, instanceId: string, seq: number, key: string, n = 1) {
    this.add((this.bucket(state).s[socketKey(instanceId, seq)] ||= {}), key, n);
  }

  private socketStats(state: SessionState, instanceId: string, seq: number): SocketStats {
    const key = seq === state.lastSocketSeq && instanceId === state.lastSocketInstance ? state.lastSocketKey : socketKey(instanceId, seq);
    state.lastSocketSeq = seq; state.lastSocketInstance = instanceId; state.lastSocketKey = key;
    let stats = state.sockets.get(key);
    if (!stats) {
      stats = {
        key, instanceId, seq, createdAt: this.now(), openedAt: null, closedAt: null, closeCode: null,
        frames: 0, rawMessage: 0, rawGroupMessage: 0, inboundMsgs: 0, upsertEvents: 0, lastRaw: null, lastInbound: null
      };
      state.sockets.set(key, stats);
      // Guarda sockets fechados por um tempo: é a evidência de duplicação.
      if (state.sockets.size > MAX_SOCKET_STATS_PER_SESSION) {
        for (const [oldKey, old] of state.sockets) {
          if (old.closedAt !== null) { state.sockets.delete(oldKey); break; }
        }
      }
    }
    return stats;
  }

  private liveSockets(state: SessionState) {
    return Array.from(state.sockets.values()).filter((stats) => stats.closedAt === null);
  }

  // ---- sockets e instâncias ----------------------------------------------------

  setManagedInstance(sessionName: string, instanceId: string | null) {
    this.managed.set(sessionName, instanceId);
    this.event(sessionName, "managed_instance", { session_instance_id: instanceId });
  }

  socketCreated(sessionName: string, instanceId: string, seq: number, accountId?: string | null) {
    if (!this.isActive(sessionName)) return;
    const state = this.state(sessionName, accountId);
    this.socketStats(state, instanceId, seq);
    this.count(sessionName, "socket_created");
    this.socketCount(state, instanceId, seq, "created");
    this.event(sessionName, "socket_created", { session_instance_id: instanceId, socket_seq: seq, live_sockets: this.liveSockets(state).length });
  }

  socketOpened(sessionName: string, instanceId: string, seq: number) {
    if (!this.isActive(sessionName)) return;
    const state = this.state(sessionName);
    this.socketStats(state, instanceId, seq).openedAt = this.now();
    this.count(sessionName, "socket_open");
    this.socketCount(state, instanceId, seq, "open");
    this.mark(sessionName, "open");
    this.event(sessionName, "socket_open", { session_instance_id: instanceId, socket_seq: seq, live_sockets: this.liveSockets(state).length });
  }

  socketClosed(sessionName: string, instanceId: string, seq: number, code: number | null, stopped: boolean) {
    if (!this.isActive(sessionName)) return;
    const state = this.state(sessionName);
    const stats = this.socketStats(state, instanceId, seq);
    stats.closedAt = this.now();
    stats.closeCode = code;
    this.count(sessionName, `close_${code ?? "none"}`);
    this.socketCount(state, instanceId, seq, `close_${code ?? "none"}`);
    this.mark(sessionName, "close");
    this.event(sessionName, "socket_closed", { session_instance_id: instanceId, socket_seq: seq, code, stopped, live_sockets: this.liveSockets(state).length });
  }

  registerInstance(sessionName: string, instanceId: string, probe: () => Record<string, unknown>, accountId?: string | null) {
    if (!this.isActive(sessionName)) return;
    const state = this.state(sessionName, accountId);
    state.probes.set(instanceId, probe);
    this.event(sessionName, "instance_registered", { session_instance_id: instanceId, instances: state.probes.size });
  }

  unregisterInstance(sessionName: string, instanceId: string, reason: string) {
    const state = this.sessions.get(sessionName);
    if (!state) return;
    state.probes.delete(instanceId);
    for (const stats of state.sockets.values()) {
      if (stats.instanceId === instanceId && stats.closedAt === null) stats.closedAt = this.now();
    }
    this.event(sessionName, "instance_released", { session_instance_id: instanceId, reason, instances: state.probes.size });
  }

  // ---- fluxo de mensagens --------------------------------------------------------

  /** Frame já decodificado pelo Baileys (antes do Signal), de um socket específico. */
  frame(sessionName: string, frame: any, instanceId: string, seq: number) {
    if (!this.isActive(sessionName) || !frame || frame instanceof Uint8Array) return;
    // Caminho quente: estado, minuto e contadores do socket resolvidos uma vez.
    const at = this.now();
    const state = this.state(sessionName);
    const bucket = this.bucket(state, at);
    const stats = this.socketStats(state, instanceId, seq);
    const c = bucket.c;
    const sc = (bucket.s[stats.key] ||= {});
    const tag = frame.tag;
    const attrs = frame.attrs || {};
    stats.frames += 1;
    c.raw_frames = (c.raw_frames || 0) + 1;
    sc.frames = (sc.frames || 0) + 1;
    if (tag === "message") {
      stats.rawMessage += 1;
      stats.lastRaw = at;
      state.last.raw_message = at;
      c.raw_message = (c.raw_message || 0) + 1;
      sc.raw_message = (sc.raw_message || 0) + 1;
      if (typeof attrs.from === "string" && attrs.from.endsWith("@g.us")) {
        stats.rawGroupMessage += 1;
        state.last.raw_group_message = at;
        c.raw_group_message = (c.raw_group_message || 0) + 1;
        sc.raw_group_message = (sc.raw_group_message || 0) + 1;
      }
      if (attrs.offline !== undefined) c.raw_offline_message = (c.raw_offline_message || 0) + 1;
      state.rawSinceInbound += 1;
      state.rawSinceAnyUpsert += 1;
    } else if (tag === "receipt") {
      c.receipt_in = (c.receipt_in || 0) + 1;
      if (attrs.type === "retry") {
        c.retry_receipt_in = (c.retry_receipt_in || 0) + 1;
        sc.retry_receipt_in = (sc.retry_receipt_in || 0) + 1;
        state.last.retry_receipt_in = at;
      }
    } else if (tag === "ack") {
      if (attrs.class === "message") {
        c.ack_message = (c.ack_message || 0) + 1;
        sc.ack_message = (sc.ack_message || 0) + 1;
        state.last.ack = at;
      } else {
        c.ack_other = (c.ack_other || 0) + 1;
      }
    } else if (tag === "notification") {
      c.notification = (c.notification || 0) + 1;
    } else if (tag === "stream:error") {
      c.stream_error = (c.stream_error || 0) + 1;
      sc.stream_error = (sc.stream_error || 0) + 1;
    } else if (tag === "ib") {
      c.ib = (c.ib || 0) + 1;
    }
  }

  /** messages.upsert de um socket: separa recebidas de enviadas (o envio também gera upsert). */
  upsert(sessionName: string, type: string | undefined, messages: any[], ciphertextStubType: number, instanceId: string, seq: number) {
    if (!this.isActive(sessionName)) return;
    const at = this.now();
    const state = this.state(sessionName);
    const stats = this.socketStats(state, instanceId, seq);
    stats.upsertEvents += 1;
    this.count(sessionName, "upsert_events");
    this.count(sessionName, `upsert_${type || "unknown"}`);
    this.socketCount(state, instanceId, seq, "upsert_events");
    this.mark(sessionName, "any_upsert", at);
    state.rawSinceAnyUpsert = 0;
    let inbound = 0;
    for (const message of messages || []) {
      if (message?.key?.fromMe) { this.count(sessionName, "fromme_msgs"); continue; }
      inbound += 1;
      if (String(message?.key?.remoteJid || "").endsWith("@g.us")) this.count(sessionName, "inbound_group_msgs");
      if (message?.messageStubType === ciphertextStubType) {
        this.count(sessionName, "decrypt_fail");
        this.count(sessionName, `decrypt_fail_${classifyDecryptError(message?.messageStubParameters?.[0])}`);
        this.socketCount(state, instanceId, seq, "decrypt_fail");
      }
    }
    if (!inbound) return;
    stats.inboundMsgs += inbound;
    stats.lastInbound = at;
    this.count(sessionName, "inbound_msgs", inbound);
    this.socketCount(state, instanceId, seq, "inbound_msgs", inbound);
    state.last.inbound_upsert = at;
    state.rawSinceInbound = 0;
    if (state.level > 0) this.recover(state, at);
  }

  // ---- detector de silêncio e incidentes -----------------------------------------

  private isOpen(state: SessionState) {
    return (state.last.open || 0) > (state.last.close || 0);
  }

  private classification(state: SessionState) {
    return state.rawSinceInbound > 0 ? RAW_SEEN_NO_INBOUND_UPSERT : NO_RAW_NO_INBOUND_UPSERT;
  }

  /** Avalia os números ativos; chamado a cada OBS_DETECT_MS. */
  tick() {
    if (!this.enabled) return;
    const at = this.now();
    for (const state of this.sessions.values()) {
      if (state.sessionName === PROCESS_SESSION || !this.isActive(state.sessionName) || !this.isOpen(state)) continue;
      const reference = Math.max(state.last.inbound_upsert || 0, state.last.open || 0);
      const silenceMs = at - reference;
      let level = 0;
      for (const minutes of CHECKPOINT_MINUTES) if (silenceMs >= minutes * MINUTE_MS) level = minutes;
      if (level <= state.level) continue;
      if (state.level === 0) state.silenceSince = reference;
      state.level = level;
      const fields = {
        level_minutes: level,
        classification: this.classification(state),
        raw_since_inbound_upsert: state.rawSinceInbound,
        raw_since_any_upsert: state.rawSinceAnyUpsert,
        last_raw_message_at: state.last.raw_message ? new Date(state.last.raw_message).toISOString() : null,
        last_inbound_upsert_at: state.last.inbound_upsert ? new Date(state.last.inbound_upsert).toISOString() : null,
        delta_raw_minus_inbound_upsert_ms: state.last.raw_message && state.last.inbound_upsert ? state.last.raw_message - state.last.inbound_upsert : null,
        live_sockets: this.liveSockets(state).length,
        silence_ms: silenceMs
      };
      this.count(state.sessionName, `checkpoint_${level}`);
      this.event(state.sessionName, "checkpoint", fields);
      this.log({ event: "obs.silence_checkpoint", session_name: state.sessionName, account_id: state.accountId, ...fields });
      if (level >= INCIDENT_LEVEL && !state.incidentId) void this.openIncident(state, "silence_20m", "detector");
    }
  }

  private recover(state: SessionState, at: number) {
    const silenceMs = at - (state.silenceSince || at);
    this.event(state.sessionName, "silence_ended", { from_level: state.level, incident_id: state.incidentId, silence_ms: silenceMs });
    this.log({ event: "obs.silence_ended", session_name: state.sessionName, from_level: state.level, incident_id: state.incidentId, silence_ms: silenceMs });
    if (state.incidentId) {
      const incidentId = state.incidentId;
      for (const incident of this.incidents) {
        if (incident.incident_id === incidentId) { incident.resolved_at = new Date(at).toISOString(); incident.silence_ms = silenceMs; }
      }
      void this.persistence?.resolveIncident(incidentId, new Date(at).toISOString(), silenceMs)
        .catch((error) => this.log({ event: "obs.persist_failed", what: "incident_resolve", error: String(error?.message || error) }));
    }
    state.level = 0;
    state.incidentId = null;
    state.silenceSince = null;
  }

  /**
   * Congela o histórico do número antes de um reinício/parada. Só grava se o
   * número já estava em silêncio (≥ 2 min) ou com incidente aberto; senão
   * fica só um evento no ring, sem escrita.
   */
  freezeBeforeRestart(sessionName: string, reason: string) {
    if (!this.isActive(sessionName)) return null;
    const state = this.state(sessionName);
    this.count(sessionName, `restart_${reason.split(":")[0]}`);
    this.event(sessionName, "pre_restart", { reason, level_minutes: state.level, incident_id: state.incidentId });
    if (state.level === 0 && !state.incidentId) return null;
    return this.openIncident(state, "pre_restart", reason);
  }

  /** Decide se este retrato pode ir ao banco (tetos por minuto, hora e número). */
  private allowWrite(state: SessionState, kind: string, at: number) {
    while (this.hourWrites.length && at - this.hourWrites[0] > HOUR_MS) this.hourWrites.shift();
    while (this.preRestartWrites.length && at - this.preRestartWrites[0] > MINUTE_MS) this.preRestartWrites.shift();
    if (this.hourWrites.length >= this.limits.perHour) return "hour_cap";
    if (kind === "pre_restart") {
      if (this.preRestartWrites.length >= this.limits.preRestartPerMinute) return "minute_cap";
      if (at - state.lastPreRestartWrite < this.limits.preRestartMinIntervalPerSessionMs) return "session_interval";
    }
    return null;
  }

  /**
   * Um episódio de silêncio = um incident_id; cada retrato do episódio é uma
   * linha. Nunca rejeita: uma promise rejeitada sem dono derrubaria o processo.
   */
  private async openIncident(state: SessionState, kind: string, reason: string): Promise<string | null> {
    try {
      const at = this.now();
      if (!state.incidentId) state.incidentId = randomUUID();
      const incidentId = state.incidentId;
      const row: IncidentRow = {
        id: randomUUID(),
        incident_id: incidentId,
        session_name: state.sessionName,
        account_id: state.accountId,
        kind,
        reason,
        level_minutes: state.level,
        classification: this.classification(state),
        detected_at: new Date(at).toISOString(),
        snapshot: { incident_id: incidentId, ...this.snapshot(state.sessionName, `${kind}:${reason}`, this.limits.snapshotMinutes) }
      };
      this.incidents.push(row);
      while (this.incidents.length > MAX_INCIDENTS_IN_MEMORY) this.incidents.shift();
      const blocked = this.allowWrite(state, kind, at);
      this.log({ event: "obs.incident", incident_id: incidentId, kind, reason, session_name: state.sessionName, account_id: state.accountId, level_minutes: state.level, classification: row.classification, persisted: !blocked, skipped_by: blocked });
      if (blocked) {
        this.count(PROCESS_SESSION, `incident_write_skipped_${blocked}`);
        return incidentId;
      }
      this.hourWrites.push(at);
      if (kind === "pre_restart") { this.preRestartWrites.push(at); state.lastPreRestartWrite = at; }
      await this.persistence?.writeIncident(row);
      return incidentId;
    } catch (error: any) {
      this.log({ event: "obs.persist_failed", what: "incident", error: String(error?.message || error) });
      return state.incidentId;
    }
  }

  /** Retrato técnico do número. */
  snapshot(sessionName: string, reason = "manual", historyMinutes = this.ringMinutes): Record<string, unknown> {
    const state = this.state(sessionName);
    const at = this.now();
    const managed = this.managed.get(sessionName) ?? null;
    const instances = Array.from(state.probes.entries()).map(([instanceId, probe]) => {
      let probed: Record<string, unknown> = {};
      try { probed = probe(); } catch (error: any) { probed = { probe_error: String(error?.message || error) }; }
      return { session_instance_id: instanceId, managed: instanceId === managed, ...probed };
    });
    const globals: Record<string, unknown> = {};
    for (const [name, probe] of this.globalProbes) {
      try { globals[name] = probe(sessionName); } catch (error: any) { globals[name] = { probe_error: String(error?.message || error) }; }
    }
    const ago = (key: string) => (state.last[key] ? at - state.last[key] : null);
    const iso = (value: number | null) => (value ? new Date(value).toISOString() : null);
    return {
      captured_at: new Date(at).toISOString(),
      reason,
      session_name: sessionName,
      account_id: state.accountId,
      socket_open: this.isOpen(state),
      managed_session_instance_id: managed,
      instances,
      sockets: Array.from(state.sockets.values()).map((stats) => ({
        socket: stats.key, session_instance_id: stats.instanceId, socket_seq: stats.seq, live: stats.closedAt === null,
        created_at: iso(stats.createdAt), opened_at: iso(stats.openedAt), closed_at: iso(stats.closedAt), close_code: stats.closeCode,
        frames: stats.frames, raw_message: stats.rawMessage, raw_group_message: stats.rawGroupMessage,
        inbound_msgs: stats.inboundMsgs, upsert_events: stats.upsertEvents,
        last_raw_message_at: iso(stats.lastRaw), last_inbound_upsert_at: iso(stats.lastInbound)
      })),
      live_socket_count: this.liveSockets(state).length,
      level_minutes: state.level,
      classification: this.classification(state),
      raw_since_inbound_upsert: state.rawSinceInbound,
      raw_since_any_upsert: state.rawSinceAnyUpsert,
      last_ms_ago: {
        raw_message: ago("raw_message"), raw_group_message: ago("raw_group_message"), inbound_upsert: ago("inbound_upsert"),
        any_upsert: ago("any_upsert"), send_ok: ago("send_ok"), ack: ago("ack"), creds_update: ago("creds_update"),
        signal_write: ago("signal_write"), retry_receipt_in: ago("retry_receipt_in"), open: ago("open"), close: ago("close")
      },
      last_at: Object.fromEntries(Object.entries(state.last).map(([key, value]) => [key, new Date(value).toISOString()])),
      delta_raw_minus_inbound_upsert_ms: state.last.raw_message && state.last.inbound_upsert ? state.last.raw_message - state.last.inbound_upsert : null,
      ...globals,
      history: state.ring.slice(-historyMinutes).map((bucket) => ({ minute: new Date(bucket.minute * MINUTE_MS).toISOString(), c: { ...bucket.c }, mx: { ...bucket.mx }, s: { ...bucket.s } })),
      events: state.events.slice(-MAX_SNAPSHOT_EVENTS)
    };
  }

  /**
   * Estado mínimo para gravar de forma síncrona numa queda (uncaughtException):
   * os últimos minutos do ring e o estado dos sockets de cada número ativo.
   * Não chama probes (podem depender do socket que está caindo).
   */
  crashDump(): Record<string, unknown> {
    const at = this.now();
    const sessions = Array.from(this.sessions.values()).filter((state) => this.isActive(state.sessionName)).map((state) => ({
      session_name: state.sessionName,
      account_id: state.accountId,
      managed_session_instance_id: this.managed.get(state.sessionName) ?? null,
      level_minutes: state.level,
      incident_id: state.incidentId,
      classification: this.classification(state),
      raw_since_inbound_upsert: state.rawSinceInbound,
      raw_since_any_upsert: state.rawSinceAnyUpsert,
      last_at: Object.fromEntries(Object.entries(state.last).map(([key, value]) => [key, new Date(value).toISOString()])),
      sockets: Array.from(state.sockets.values()),
      history: state.ring.slice(-CRASH_DUMP_MINUTES).map((bucket) => ({ minute: new Date(bucket.minute * MINUTE_MS).toISOString(), c: bucket.c, mx: bucket.mx, s: bucket.s })),
      events: state.events.slice(-CRASH_DUMP_EVENTS)
    }));
    return { dumped_at: new Date(at).toISOString(), config: this.config(), sessions };
  }

  // ---- gravação em lote ------------------------------------------------------------

  collectClosedMinutes(): { rows: MinuteRow[]; buckets: MinuteBucket[] } {
    const currentMinute = Math.floor(this.now() / MINUTE_MS);
    const rows: MinuteRow[] = [];
    const buckets: MinuteBucket[] = [];
    for (const state of this.sessions.values()) {
      for (const bucket of state.ring) {
        if (bucket.flushed || bucket.minute >= currentMinute) continue;
        const data: MinuteRow["data"] = { c: bucket.c, mx: bucket.mx };
        if (Object.keys(bucket.s).length) data.s = bucket.s;
        rows.push({ session_name: state.sessionName, account_id: state.accountId, minute: new Date(bucket.minute * MINUTE_MS).toISOString(), data });
        buckets.push(bucket);
      }
    }
    return { rows, buckets };
  }

  async flush() {
    if (this.flushing || !this.persistence) return 0;
    this.flushing = true;
    try {
      const { rows, buckets } = this.collectClosedMinutes();
      if (!rows.length) return 0;
      await this.persistence.writeMinutes(rows);
      for (const bucket of buckets) bucket.flushed = true;
      return rows.length;
    } catch (error: any) {
      // Fica para o próximo lote; o ring guarda até ringMinutes.
      this.log({ event: "obs.persist_failed", what: "minutes", error: String(error?.message || error) });
      return 0;
    } finally {
      this.flushing = false;
    }
  }

  listIncidents() { return this.incidents.slice(); }
  listSessions() {
    return Array.from(this.sessions.values()).map((state) => ({
      session_name: state.sessionName, account_id: state.accountId, active: this.isActive(state.sessionName), socket_open: this.isOpen(state),
      level_minutes: state.level, incident_id: state.incidentId, live_socket_count: this.liveSockets(state).length,
      instances: state.probes.size, managed_session_instance_id: this.managed.get(state.sessionName) ?? null,
      raw_since_inbound_upsert: state.rawSinceInbound
    }));
  }
}

export const observer = new SessionObserver({
  ringMinutes: Number(process.env.OBS_RING_MINUTES) || 60,
  limits: {
    perHour: Number(process.env.OBS_INCIDENT_MAX_PER_HOUR) || 30,
    snapshotMinutes: Number(process.env.OBS_SNAPSHOT_MINUTES) || 30
  }
});
