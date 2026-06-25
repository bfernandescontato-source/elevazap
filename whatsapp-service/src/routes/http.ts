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
  startSenderSessionByName
} from "../senders/runtime.js";

function requireInternalKey(req: express.Request, res: express.Response, next: express.NextFunction) {
  if (req.path === "/health") return next();
  if (req.header("x-internal-api-key") !== process.env.INTERNAL_API_KEY) return res.status(401).json({ error: "Não autorizado." });
  return next();
}

async function ffmpegStatus() {
  return new Promise<"ok" | "missing">((resolve) => execFile("ffmpeg", ["-version"], (error) => resolve(error ? "missing" : "ok")));
}

export function createHttpServer(runtime: WhatsAppRuntime, queue: GlobalSendQueue) {
  const app = express();
  app.use(express.json());
  app.use(requireInternalKey);

  // Existing routes
  app.get("/health", (_req, res) => res.json({ ok: true }));
  app.get("/status", async (_req, res) => res.json({ status: runtime.getStatus(), queue: queue.stats(), lock: "active", ffmpeg: await ffmpegStatus() }));
  app.get("/qr", (_req, res) => res.json({ qr: runtime.getQr() }));
  app.post("/restart", async (_req, res) => { await runtime.restart(); res.json({ ok: true }); });
  app.post("/logout", async (_req, res) => { await runtime.logout(); res.json({ ok: true }); });
  app.get("/groups", async (_req, res) => res.json({ groups: await runtime.refreshGroups() }));
  app.post("/refresh-groups", async (_req, res) => res.json({ groups: await runtime.refreshGroups() }));

  app.get("/senders/:sessionName/status", (req, res) => {
    res.json(getSenderStatus(req.params.sessionName));
  });

  app.post("/senders/:sessionName/connect", async (req, res) => {
    try {
      await startSenderSessionByName(req.params.sessionName);
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
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
