import express from "express";
import { execFile } from "child_process";
import type { GlobalSendQueue } from "../queue/queue.js";
import type { WhatsAppRuntime } from "../whatsapp.js";
import {
  bootSupportRuntime,
  reloadSupportAgent,
  disconnectSupportSession,
  getSupportSessionStatus,
  startNewSupportSession
} from "../support/runtime.js";
import {
  disconnectSenderSession,
  getSenderStatus,
  refreshSenderGroups,
  resolveSenderGroupInvite,
  syncSenderGroups,
  startSenderSessionByName
} from "../senders/runtime.js";
import { waitForSessionReady } from "../utils/session-ready.js";

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
  runtimeRef: { current: WhatsAppRuntime | null },
  queueRef: { current: GlobalSendQueue | null },
  readiness: ServiceReadiness
) {
  const app = express();
  app.use(express.json());
  app.use(requireInternalKey);

  // Existing routes
  app.get("/health", (_req, res) => res.json({ ok: true, process: "alive" }));
  app.get("/ready", (_req, res) => {
    const runtime = runtimeRef.current;
    const state = runtime?.getStatus() || "idle";
    const ready = readiness.supabase && readiness.queue && state === "connected";
    res.status(ready ? 200 : 503).json({
      ready,
      process_started: readiness.processStarted,
      supabase_accessible: readiness.supabase,
      queue_active: readiness.queue,
      whatsapp_available: state === "connected",
      whatsapp_state: state,
      last_error: runtime?.getLastError() || readiness.lastError
    });
  });
  app.get("/status", async (_req, res) => {
    const runtime = runtimeRef.current;
    if (!runtime) return res.status(503).json({ status: "idle", error: "Serviço WhatsApp ainda está inicializando." });
    const user = runtime.sock?.user;
    const phoneNumber = user?.id ? user.id.split(":")[0].split("@")[0] : "";
    res.json({
      status: runtime.getStatus(),
      phone_number: phoneNumber,
      display_name: user?.name || "",
      queue: queueRef.current?.stats() || { running: false, size: 0 },
      lock: "active",
      ffmpeg: await ffmpegStatus()
    });
  });
  app.get("/qr", (_req, res) => {
    const runtime = runtimeRef.current;
    if (!runtime) return res.status(503).json({ error: "Serviço WhatsApp ainda está inicializando." });
    return res.json({ qr: runtime.getQr(), status: runtime.getStatus() });
  });
  app.post("/restart", async (_req, res) => {
    const runtime = runtimeRef.current;
    if (!runtime) return res.status(503).json({ error: "Serviço WhatsApp ainda está inicializando." });
    try {
      await runtime.restart();
      const result = await waitForSessionReady(() => ({
        status: runtime.getStatus(),
        qr: runtime.getQr(),
        error: runtime.getLastError()
      }));
      if (result.status === "failed" || result.status === "logged_out") {
        return res.status(503).json({ ...result, error: result.error || "Não foi possível gerar o QR Code." });
      }
      return res.status(result.qr || result.status === "connected" ? 200 : 202).json({ ok: true, ...result });
    } catch (e: any) {
      return res.status(503).json({ error: e?.message || "Não foi possível gerar o QR Code." });
    }
  });
  app.post("/logout", async (_req, res) => {
    const runtime = runtimeRef.current;
    if (!runtime) return res.status(503).json({ error: "Serviço WhatsApp ainda está inicializando." });
    await runtime.logout();
    return res.json({ ok: true });
  });
  app.get("/groups", async (_req, res) => {
    const runtime = runtimeRef.current;
    if (!runtime) return res.status(503).json({ error: "Serviço WhatsApp ainda está inicializando." });
    return res.json({ groups: await runtime.refreshGroups() });
  });
  app.post("/refresh-groups", async (_req, res) => {
    try {
      const runtime = runtimeRef.current;
      if (!runtime) return res.status(503).json({ error: "Serviço WhatsApp ainda está inicializando." });
      return res.json({ groups: await runtime.refreshGroups() });
    } catch (e: any) {
      return res.status(503).json({ error: e?.message || "Não foi possível atualizar os grupos." });
    }
  });
  app.post("/groups/resolve-invite", async (req, res) => {
    try {
      const runtime = runtimeRef.current;
      if (!runtime) return res.status(503).json({ error: "Serviço WhatsApp ainda está inicializando." });
      res.json({ group: await runtime.resolveGroupInvite(String(req.body?.inviteUrl || "")) });
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });
  app.post("/groups/sync", async (req, res) => {
    try {
      const runtime = runtimeRef.current;
      if (!runtime) return res.status(503).json({ error: "Serviço WhatsApp ainda está inicializando." });
      const groupJids = Array.isArray(req.body?.groupJids) ? req.body.groupJids : [];
      res.json({ groups: await runtime.syncGroups(groupJids) });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

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

  // Support agent routes
  app.get("/support/:agentId/status", (req, res) => {
    const info = getSupportSessionStatus(req.params.agentId);
    res.json(info);
  });

  app.post("/support/:agentId/connect", async (req, res) => {
    try {
      const { sessionId } = req.body as { sessionId: string };
      if (!sessionId) return res.status(400).json({ error: "sessionId obrigatório." });
      await startNewSupportSession(req.params.agentId, sessionId);
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/support/:agentId/reload", async (req, res) => {
    try {
      await reloadSupportAgent(req.params.agentId);
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/support/:agentId/disconnect", async (req, res) => {
    try {
      await disconnectSupportSession(req.params.agentId);
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Human reply from panel — sends message via support session and marks message ID as human
  app.post("/support/:agentId/send", async (req, res) => {
    try {
      const { jid, text } = req.body as { jid: string; text: string };
      if (!jid || !text) return res.status(400).json({ error: "jid e text obrigatórios." });
      const { getSupportSessionStatus } = await import("../support/runtime.js");
      const info = getSupportSessionStatus(req.params.agentId);
      if (info.status !== "connected") return res.status(503).json({ error: "Sessão de suporte não conectada." });

      // Get the sock from runtime — we need a helper for this
      const { sendViaAgent } = await import("../support/runtime.js");
      const result = await sendViaAgent(req.params.agentId, jid, text);
      res.json({ ok: true, waMessageId: result });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  return app;
}

export { bootSupportRuntime };
