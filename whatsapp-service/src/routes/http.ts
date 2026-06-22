import express from "express";
import { execFile } from "child_process";
import type { GlobalSendQueue } from "../queue/queue.js";
import type { WhatsAppRuntime } from "../whatsapp.js";

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

  app.get("/health", (_req, res) => res.json({ ok: true }));
  app.get("/status", async (_req, res) => res.json({ status: runtime.getStatus(), queue: queue.stats(), lock: "active", ffmpeg: await ffmpegStatus() }));
  app.get("/qr", (_req, res) => res.json({ qr: runtime.getQr() }));
  app.post("/logout", async (_req, res) => { await runtime.logout(); res.json({ ok: true }); });
  app.get("/groups", async (_req, res) => res.json({ groups: await runtime.refreshGroups() }));
  app.post("/refresh-groups", async (_req, res) => res.json({ groups: await runtime.refreshGroups() }));
  return app;
}
