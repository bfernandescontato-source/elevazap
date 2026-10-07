import { randomUUID } from "crypto";

/**
 * Observabilidade da investigação do "número surdo" (07/10).
 *
 * Só observa: nada aqui muda conexão, fila ou envio. Os contadores ficam em
 * memória, agregados por minuto num ring buffer por número (últimos N minutos),
 * e vão ao banco em lote (uma gravação a cada OBS_FLUSH_MS para todos os
 * números juntos). Um incidente congela o histórico do número e grava na hora.
 *
 * A pergunta principal que estes dados respondem: durante a surdez, as
 * stanzas cruas continuam chegando ao WebSocket (pipeline travado no Baileys)
 * ou param também (o WhatsApp deixou de entregar)?
 */

export const PROCESS_SESSION = "__process__";
export const CHECKPOINT_MINUTES = [2, 5, 10, 20] as const;
const INCIDENT_LEVEL = 20;
const MINUTE_MS = 60_000;
const MAX_EVENTS_PER_SESSION = 500;
const MAX_INCIDENTS_IN_MEMORY = 50;
const MAX_SNAPSHOT_EVENTS = 200;
// Numa reaquisição em massa, dezenas de números podem gerar retrato ao mesmo
// tempo, justo quando o banco está sob pressão. Retratos de pré-reinício além
// deste limite ficam só em memória; o detector de 20 min sempre grava.
const MAX_PRE_RESTART_WRITES_PER_MINUTE = 12;

export type Counters = Record<string, number>;
export type MinuteBucket = { minute: number; c: Counters; mx: Counters; flushed: boolean };
export type ObsEvent = { at: number; type: string; [key: string]: unknown };

export type MinuteRow = { session_name: string; account_id: string | null; minute: string; data: { c: Counters; mx: Counters } };
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

type SocketEntry = { instanceId: string; seq: number; createdAt: number; openedAt: number | null };

type SessionState = {
  sessionName: string;
  accountId: string | null;
  ring: MinuteBucket[];
  events: ObsEvent[];
  last: Record<string, number>;
  rawSinceInbound: number;
  sockets: Map<string, SocketEntry>;
  probes: Map<string, () => Record<string, unknown>>;
  managedInstanceId: string | null;
  level: number;
  incidentId: string | null;
  silenceSince: number | null;
};

export type ObserverOptions = {
  now?: () => number;
  ringMinutes?: number;
  persistence?: ObsPersistence | null;
  log?: (entry: Record<string, unknown>) => void;
};

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

export class SessionObserver {
  private readonly sessions = new Map<string, SessionState>();
  private readonly incidents: IncidentRow[] = [];
  private readonly globalProbes = new Map<string, (sessionName: string) => unknown>();
  private readonly now: () => number;
  private readonly ringMinutes: number;
  private persistence: ObsPersistence | null;
  private readonly log: (entry: Record<string, unknown>) => void;
  private flushing = false;
  private readonly recentIncidentWrites: number[] = [];

  constructor(options: ObserverOptions = {}) {
    this.now = options.now || Date.now;
    this.ringMinutes = options.ringMinutes || 60;
    this.persistence = options.persistence ?? null;
    this.log = options.log || ((entry) => console.info({ component: "obs", ...entry }));
  }

  setPersistence(persistence: ObsPersistence | null) { this.persistence = persistence; }

  /** Uma fonte de estado que não é do número (fila de auth, event loop, supervisor). */
  registerGlobalProbe(name: string, probe: (sessionName: string) => unknown) { this.globalProbes.set(name, probe); }

  private state(sessionName: string, accountId?: string | null): SessionState {
    let state = this.sessions.get(sessionName);
    if (!state) {
      state = {
        sessionName, accountId: accountId || null, ring: [], events: [], last: {}, rawSinceInbound: 0,
        sockets: new Map(), probes: new Map(), managedInstanceId: null, level: 0, incidentId: null, silenceSince: null
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
    const created: MinuteBucket = { minute, c: {}, mx: {}, flushed: false };
    state.ring.push(created);
    while (state.ring.length > this.ringMinutes) state.ring.shift();
    return created;
  }

  count(sessionName: string, key: string, n = 1, accountId?: string | null) {
    const state = this.state(sessionName, accountId);
    const bucket = this.bucket(state);
    bucket.c[key] = (bucket.c[key] || 0) + n;
  }

  max(sessionName: string, key: string, value: number) {
    if (!Number.isFinite(value)) return;
    const bucket = this.bucket(this.state(sessionName));
    if (bucket.mx[key] === undefined || value > bucket.mx[key]) bucket.mx[key] = value;
  }

  mark(sessionName: string, key: string, at = this.now()) { this.state(sessionName).last[key] = at; }

  event(sessionName: string, type: string, fields: Record<string, unknown> = {}) {
    const state = this.state(sessionName);
    state.events.push({ at: this.now(), type, ...fields });
    if (state.events.length > MAX_EVENTS_PER_SESSION) state.events.shift();
  }

  // ---- sockets e instâncias de sessão ------------------------------------

  socketCreated(sessionName: string, instanceId: string, seq: number, accountId?: string | null) {
    const state = this.state(sessionName, accountId);
    state.sockets.set(`${instanceId}:${seq}`, { instanceId, seq, createdAt: this.now(), openedAt: null });
    this.count(sessionName, "socket_created");
    this.event(sessionName, "socket_created", { instanceId, seq, live: state.sockets.size });
  }

  socketOpened(sessionName: string, instanceId: string, seq: number) {
    const state = this.state(sessionName);
    const entry = state.sockets.get(`${instanceId}:${seq}`);
    if (entry) entry.openedAt = this.now();
    this.count(sessionName, "socket_open");
    this.mark(sessionName, "open");
    this.event(sessionName, "socket_open", { instanceId, seq, live: state.sockets.size });
  }

  socketClosed(sessionName: string, instanceId: string, seq: number, code: number | null, stopped: boolean) {
    const state = this.state(sessionName);
    state.sockets.delete(`${instanceId}:${seq}`);
    this.count(sessionName, `close_${code ?? "none"}`);
    this.mark(sessionName, "close");
    this.event(sessionName, "socket_closed", { instanceId, seq, code, stopped, live: state.sockets.size });
  }

  registerInstance(sessionName: string, instanceId: string, probe: () => Record<string, unknown>, accountId?: string | null) {
    const state = this.state(sessionName, accountId);
    state.probes.set(instanceId, probe);
    this.event(sessionName, "instance_created", { instanceId, instances: state.probes.size });
  }

  unregisterInstance(sessionName: string, instanceId: string, reason: string) {
    const state = this.state(sessionName);
    state.probes.delete(instanceId);
    for (const [key, entry] of state.sockets) if (entry.instanceId === instanceId) state.sockets.delete(key);
    this.event(sessionName, "instance_released", { instanceId, reason, instances: state.probes.size });
  }

  setManagedInstance(sessionName: string, instanceId: string | null) {
    this.state(sessionName).managedInstanceId = instanceId;
    this.event(sessionName, "managed_instance", { instanceId });
  }

  // ---- fluxo de mensagens --------------------------------------------------

  /** Frame já decodificado pelo Baileys, antes de qualquer decriptação. */
  frame(sessionName: string, frame: any) {
    if (!frame || frame instanceof Uint8Array) return;
    const tag = String(frame.tag || "");
    const attrs = frame.attrs || {};
    this.count(sessionName, "raw_frames");
    if (tag === "message") {
      const at = this.now();
      this.count(sessionName, "raw_message");
      this.mark(sessionName, "raw_message", at);
      if (String(attrs.from || "").endsWith("@g.us")) {
        this.count(sessionName, "raw_group_message");
        this.mark(sessionName, "raw_group_message", at);
      }
      if (attrs.offline !== undefined) this.count(sessionName, "raw_offline_message");
      this.state(sessionName).rawSinceInbound += 1;
    } else if (tag === "receipt") {
      this.count(sessionName, "receipt_in");
      if (attrs.type === "retry") {
        this.count(sessionName, "retry_receipt_in");
        this.mark(sessionName, "retry_receipt_in");
      }
    } else if (tag === "ack") {
      if (attrs.class === "message") {
        this.count(sessionName, "ack_message");
        this.mark(sessionName, "ack");
      } else {
        this.count(sessionName, "ack_other");
      }
    } else if (tag === "notification") {
      this.count(sessionName, "notification");
    } else if (tag === "stream:error") {
      this.count(sessionName, "stream_error");
    } else if (tag === "ib") {
      this.count(sessionName, "ib");
    }
  }

  /** messages.upsert: separa recebidas de enviadas (o envio também gera upsert). */
  upsert(sessionName: string, type: string | undefined, messages: any[], ciphertextStubType: number) {
    const at = this.now();
    this.count(sessionName, "upsert_events");
    this.count(sessionName, `upsert_${type || "unknown"}`);
    this.mark(sessionName, "any_upsert", at);
    let inbound = 0;
    for (const message of messages || []) {
      const fromMe = Boolean(message?.key?.fromMe);
      if (fromMe) { this.count(sessionName, "fromme_msgs"); continue; }
      inbound += 1;
      if (String(message?.key?.remoteJid || "").endsWith("@g.us")) this.count(sessionName, "inbound_group_msgs");
      if (message?.messageStubType === ciphertextStubType) {
        this.count(sessionName, "decrypt_fail");
        this.count(sessionName, `decrypt_fail_${classifyDecryptError(message?.messageStubParameters?.[0])}`);
      }
    }
    if (!inbound) return;
    this.count(sessionName, "inbound_msgs", inbound);
    const state = this.state(sessionName);
    state.last.inbound_upsert = at;
    state.rawSinceInbound = 0;
    if (state.level > 0) this.recover(state, at);
  }

  // ---- detector de silêncio e incidentes ---------------------------------

  private isOpen(state: SessionState) {
    return (state.last.open || 0) > (state.last.close || 0);
  }

  private classification(state: SessionState) {
    return state.rawSinceInbound > 0 ? "RAW_WITHOUT_UPSERT" : "ALL_SILENT";
  }

  /** Avalia todos os números; chamado a cada OBS_DETECT_MS. */
  tick() {
    const at = this.now();
    for (const state of this.sessions.values()) {
      if (state.sessionName === PROCESS_SESSION) continue;
      if (!this.isOpen(state)) continue;
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
        raw_since_inbound: state.rawSinceInbound,
        delta_raw_minus_upsert_ms: (state.last.raw_message || 0) - (state.last.inbound_upsert || 0),
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
    this.event(state.sessionName, "recovered", { from_level: state.level, incident_id: state.incidentId, silence_ms: silenceMs });
    this.log({ event: "obs.silence_recovered", session_name: state.sessionName, from_level: state.level, incident_id: state.incidentId, silence_ms: silenceMs });
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
   * Congela o histórico do número antes de qualquer reinício/parada. Só grava
   * se o número já estava em silêncio (≥ 2 min) ou com incidente aberto;
   * senão fica só um evento no ring (sem escrita).
   */
  freezeBeforeRestart(sessionName: string, reason: string) {
    const state = this.state(sessionName);
    this.count(sessionName, `restart_${reason}`);
    this.event(sessionName, "pre_restart", { reason, level_minutes: state.level, incident_id: state.incidentId });
    if (state.level === 0 && !state.incidentId) return null;
    return this.openIncident(state, "pre_restart", reason);
  }

  /**
   * Um episódio de silêncio = um incident_id. Cada retrato do episódio
   * (detector de 20 min, cada pré-reinício) é uma linha própria com esse id.
   */
  private async openIncident(state: SessionState, kind: string, reason: string): Promise<string | null> {
    // Nunca rejeita: uma promise rejeitada sem dono derrubaria o processo.
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
        snapshot: { incident_id: incidentId, ...this.snapshot(state.sessionName, `${kind}:${reason}`) }
      };
      this.incidents.push(row);
      while (this.incidents.length > MAX_INCIDENTS_IN_MEMORY) this.incidents.shift();
      while (this.recentIncidentWrites.length && at - this.recentIncidentWrites[0] > MINUTE_MS) this.recentIncidentWrites.shift();
      const throttled = kind === "pre_restart" && this.recentIncidentWrites.length >= MAX_PRE_RESTART_WRITES_PER_MINUTE;
      this.log({ event: "obs.incident", incident_id: incidentId, kind, reason, session_name: state.sessionName, account_id: state.accountId, level_minutes: state.level, classification: row.classification, persisted: !throttled });
      if (throttled) {
        this.count(PROCESS_SESSION, "incident_write_skipped");
        return incidentId;
      }
      this.recentIncidentWrites.push(at);
      await this.persistence?.writeIncident(row);
      return incidentId;
    } catch (error: any) {
      this.log({ event: "obs.persist_failed", what: "incident", error: String(error?.message || error) });
      return state.incidentId;
    }
  }

  /** Retrato técnico do número (item 6 da investigação). */
  snapshot(sessionName: string, reason = "manual"): Record<string, unknown> {
    const state = this.state(sessionName);
    const at = this.now();
    const instances = Array.from(state.probes.entries()).map(([instanceId, probe]) => {
      let probed: Record<string, unknown> = {};
      try { probed = probe(); } catch (error: any) { probed = { probe_error: String(error?.message || error) }; }
      return { instanceId, managed: instanceId === state.managedInstanceId, ...probed };
    });
    const globals: Record<string, unknown> = {};
    for (const [name, probe] of this.globalProbes) {
      try { globals[name] = probe(sessionName); } catch (error: any) { globals[name] = { probe_error: String(error?.message || error) }; }
    }
    const ago = (key: string) => (state.last[key] ? at - state.last[key] : null);
    return {
      captured_at: new Date(at).toISOString(),
      reason,
      session_name: sessionName,
      account_id: state.accountId,
      socket_open: this.isOpen(state),
      managed_instance_id: state.managedInstanceId,
      instances,
      live_sockets: Array.from(state.sockets.values()),
      live_socket_count: state.sockets.size,
      level_minutes: state.level,
      classification: this.classification(state),
      raw_since_inbound: state.rawSinceInbound,
      last_ms_ago: {
        raw_message: ago("raw_message"), raw_group_message: ago("raw_group_message"), inbound_upsert: ago("inbound_upsert"),
        any_upsert: ago("any_upsert"), send_ok: ago("send_ok"), ack: ago("ack"), creds_update: ago("creds_update"),
        signal_write: ago("signal_write"), retry_receipt_in: ago("retry_receipt_in"), open: ago("open"), close: ago("close")
      },
      last_at: Object.fromEntries(Object.entries(state.last).map(([key, value]) => [key, new Date(value).toISOString()])),
      delta_raw_minus_upsert_ms: (state.last.raw_message || 0) - (state.last.inbound_upsert || 0),
      ...globals,
      history: state.ring.map((bucket) => ({ minute: new Date(bucket.minute * MINUTE_MS).toISOString(), c: { ...bucket.c }, mx: { ...bucket.mx } })),
      events: state.events.slice(-MAX_SNAPSHOT_EVENTS)
    };
  }

  // ---- gravação em lote ----------------------------------------------------

  /** Minutos fechados ainda não gravados, de todos os números. */
  collectClosedMinutes(): { rows: MinuteRow[]; buckets: MinuteBucket[] } {
    const currentMinute = Math.floor(this.now() / MINUTE_MS);
    const rows: MinuteRow[] = [];
    const buckets: MinuteBucket[] = [];
    for (const state of this.sessions.values()) {
      for (const bucket of state.ring) {
        if (bucket.flushed || bucket.minute >= currentMinute) continue;
        rows.push({ session_name: state.sessionName, account_id: state.accountId, minute: new Date(bucket.minute * MINUTE_MS).toISOString(), data: { c: bucket.c, mx: bucket.mx } });
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
      session_name: state.sessionName, account_id: state.accountId, socket_open: this.isOpen(state), level_minutes: state.level,
      incident_id: state.incidentId, live_socket_count: state.sockets.size, instances: state.probes.size,
      raw_since_inbound: state.rawSinceInbound
    }));
  }
}

export const observer = new SessionObserver({ ringMinutes: Number(process.env.OBS_RING_MINUTES) || 60 });
