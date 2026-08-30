import express from "express";
import { execFile } from "child_process";
import type { GlobalSendQueue } from "../queue/queue.js";
import {
  disconnectSenderSession,
  getSenderStatus,
  refreshSenderGroups,
  regenerateSenderGroupInviteLinks,
  resolveSenderGroupInvite,
  syncSenderGroups,
  listSenderGroupContacts,
  startSenderSessionByName,
  getSenderRuntimeStats
} from "../senders/runtime.js";
import { waitForSessionReady } from "../utils/session-ready.js";
import { retryCapturedOffer } from "../offers/offer-retry.js";

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
