import express from "express";
import { execFile } from "child_process";
import type { GlobalSendQueue } from "../queue/queue.js";
import {
  disconnectSenderSession,
  ensureSenderListening,
  getSenderStatus,
  refreshSenderGroups,
  regenerateSenderGroupInviteLinks,
  updateSenderGroupProfiles,
  resolveSenderGroupInvite,
  syncSenderGroups,
  listSenderGroupContacts,
  startSenderSessionByName,
  restartSenderSessionByName,
  getSenderRuntimeStats
} from "../senders/runtime.js";
import { waitForSessionReady } from "../utils/session-ready.js";
import { retryCapturedOffer } from "../offers/offer-retry.js";
import { observer } from "../observability/observer.js";
import { recentEventLoop, recentSupervisorCycles } from "../observability/supervisor-trace.js";
import { runtimeHookState } from "../observability/bootstrap.js";
import { liveInstanceCount, observabilityListenerCount } from "../observability/socket-hooks.js";

function requireInternalKey(req: express.Request, res: express.Response, next: express.NextFunction) {
  if (req.path === "/health" || req.path === "/ready") return next();
  if (req.header("x-internal-api-key") !== process.env.INTERNAL_API_KEY) return res.status(401).json({ error: "Não autorizado." });
  return next();
}

async function ffmpegStatus() {
  return new Promise<"ok" | "missing">((resolve) => execFile("ffmpeg", ["-version"], (error) => resolve(error ? "missing" : "ok")));
}

export type ServiceReadiness = {
  processStarted: boolean;
  supabase: boolean;
  queue: boolean;
  lastError: string | null;
};

export function createHttpServer(
  queueRef: { current: GlobalSendQueue | null },
  readiness: ServiceReadiness
) {
  const app = express();
  app.use(express.json());
  app.use(requireInternalKey);

  // Existing routes
  app.get("/health", (_req, res) => res.json({ ok: true, process: "alive" }));
  app.get("/ready", (_req, res) => {
    const senders = getSenderRuntimeStats();
    const ready = readiness.supabase && readiness.queue;
    res.status(ready ? 200 : 503).json({
      ready,
      process_started: readiness.processStarted,
      supabase_accessible: readiness.supabase,
      queue_active: readiness.queue,
      whatsapp_available: senders.connected > 0,
      sender_sessions: senders,
      last_error: readiness.lastError
    });
  });
  app.get("/status", async (_req, res) => {
    const senders = getSenderRuntimeStats();
    res.json({
      status: senders.connected > 0 ? "connected" : "disconnected",
      senders,
      queue: queueRef.current?.stats() || { running: false, size: 0 },
      lock: "active",
      ffmpeg: await ffmpegStatus()
    });
  });
  app.get("/metrics", (_req, res) => res.json({ queue: queueRef.current?.stats() || { running: false }, senders: getSenderRuntimeStats() }));

  // Observabilidade da investigação do número surdo (só leitura).
  app.get("/obs/config", (_req, res) => res.json({ ...observer.config(), hooks: { ...runtimeHookState(), socket_listeners: observabilityListenerCount(), live_instances: liveInstanceCount() } }));
  // Liga/desliga e canary sem reiniciar (vale até o próximo restart; depois volta ao env).
  app.post("/obs/config", (req, res) => {
    const body = req.body || {};
    if (body.enabled !== undefined && typeof body.enabled !== "boolean") return res.status(400).json({ error: "enabled deve ser booleano." });
    if (body.sessions !== undefined && body.sessions !== null && !(Array.isArray(body.sessions) && body.sessions.every((item: unknown) => typeof item === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(item)))) {
      return res.status(400).json({ error: "sessions deve ser null ou lista de session_name." });
    }
    const config = observer.configure({ enabled: body.enabled, sessions: body.sessions });
    res.json({ ...config, hooks: { ...runtimeHookState(), socket_listeners: observabilityListenerCount(), live_instances: liveInstanceCount() } });
  });
  app.get("/obs/sessions", (_req, res) => res.json({ sessions: observer.listSessions() }));
  app.get("/obs/sessions/:sessionName", (req, res) => res.json(observer.snapshot(req.params.sessionName, "http")));
  app.get("/obs/incidents", (_req, res) => res.json({ incidents: observer.listIncidents() }));
  app.get("/obs/supervisor", (_req, res) => res.json({ supervisor: recentSupervisorCycles(Number(_req.query.limit) || 40), event_loop: recentEventLoop() }));

  app.get("/senders/:sessionName/status", (req, res) => {
    res.json(getSenderStatus(req.params.sessionName));
  });

  app.post("/senders/:sessionName/connect", async (req, res) => {
    try {
      await startSenderSessionByName(req.params.sessionName);
      const result = await waitForSessionReady(() => getSenderStatus(req.params.sessionName));
      if (result.status === "failed" || result.status === "logged_out") {
        return res.status(503).json({ ...result, error: result.error || "Não foi possível gerar o QR Code." });
      }
      return res.status(result.qr || result.status === "connected" ? 200 : 202).json({ ok: true, ...result });
    } catch (e: any) {
      return res.status(503).json({ error: e.message });
    }
  });

  app.post("/senders/:sessionName/disconnect", async (req, res) => {
    try {
      await disconnectSenderSession(req.params.sessionName);
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/senders/:sessionName/restart", async (req, res) => {
    try {
      const sender = await restartSenderSessionByName(req.params.sessionName);
      const result = await waitForSessionReady(() => getSenderStatus(sender.sessionName));
      return res.status(result.status === "connected" ? 200 : 202).json({ ok: true, ...result });
    } catch (e: any) {
      return res.status(503).json({ error: e.message });
    }
  });

  // Chamado ao salvar o Piloto: número surdo há 10 min é reiniciado na hora.
  app.post("/senders/:sessionName/ensure-listening", async (req, res) => {
    try {
      res.json(await ensureSenderListening(req.params.sessionName, 10 * 60_000, "pilot_saved"));
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/senders/:sessionName/refresh-groups", async (req, res) => {
    try {
      res.json({ groups: await refreshSenderGroups(req.params.sessionName) });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/senders/:sessionName/groups/resolve-invite", async (req, res) => {
    try {
      res.json({ group: await resolveSenderGroupInvite(req.params.sessionName, String(req.body?.inviteUrl || "")) });
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  app.post("/senders/:sessionName/groups/sync", async (req, res) => {
    try {
      const groupJids = Array.isArray(req.body?.groupJids) ? req.body.groupJids : [];
      res.json({ groups: await syncSenderGroups(req.params.sessionName, groupJids) });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/senders/:sessionName/groups/regenerate-invites", async (req, res) => {
    try {
      const groupJids = Array.isArray(req.body?.groupJids) ? req.body.groupJids : [];
      res.json({ groups: await regenerateSenderGroupInviteLinks(req.params.sessionName, groupJids) });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/senders/:sessionName/groups/update-profiles", async (req, res) => {
    try {
      const groupJids = Array.isArray(req.body?.groupJids) ? req.body.groupJids : [];
      const update: { subject?: string; description?: string; photoUrl?: string } = {};
      if (typeof req.body?.subject === "string") update.subject = req.body.subject;
      if (typeof req.body?.description === "string") update.description = req.body.description;
      if (typeof req.body?.photoUrl === "string") update.photoUrl = req.body.photoUrl;
      if (!groupJids.length || !Object.keys(update).length) return res.status(400).json({ error: "Informe grupos e ao menos uma alteração." });
      res.json({ groups: await updateSenderGroupProfiles(req.params.sessionName, groupJids, update) });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/senders/:sessionName/groups/contacts", async (req, res) => {
    try {
      res.json(await listSenderGroupContacts(req.params.sessionName, String(req.body?.groupJid || "")));
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/offers/:offerId/retry-conversion", async (req, res) => {
    try {
      const accountId = String(req.body?.accountId || "");
      if (!/^[0-9a-f-]{36}$/i.test(accountId)) return res.status(400).json({ error: "Conta inválida." });
      return res.json({ offer: await retryCapturedOffer(accountId, req.params.offerId) });
    } catch (error) {
      console.error({ event: "shopee_conversion_retry_failed", component: "offer-autopilot", offer_id: req.params.offerId, error_type: error instanceof Error ? error.name : "unknown" });
      return res.status(400).json({ error: error instanceof Error ? error.message : "Não foi possível tentar novamente." });
    }
  });

  return app;
}
