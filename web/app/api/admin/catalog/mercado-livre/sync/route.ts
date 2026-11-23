import { timingSafeEqual } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { env } from "@/lib/env";
import { supabaseAdmin } from "@/lib/supabase";
import { syncMercadoLivreHub } from "@/modules/affiliate-catalog/server/mercado-livre-hub-service";

export const runtime = "nodejs";
export const maxDuration = 300;

const schema = z.object({
  accountId: z.string().uuid(),
  pagesPerCategory: z.number().int().min(1).max(6).optional(),
  delayMs: z.number().int().min(0).max(5000).optional()
});

function authorized(request: NextRequest) {
  const secret = env().CRON_SECRET;
  if (!secret) return false;
  const received = Buffer.from(request.headers.get("authorization") || "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return received.length === expected.length && timingSafeEqual(received, expected);
}

// Rotina diária do servidor: atualiza o catálogo do Mercado Livre pela central de
// afiliados usando a sessão guardada de uma conta da equipe (sem depender do Chrome
// dos alunos). A conta vem do agendador, nunca de um usuário.
export async function POST(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Parâmetros inválidos." }, { status: 400 });
  const started = Date.now();
  try {
    const result = await syncMercadoLivreHub(supabaseAdmin(), parsed.data.accountId, {
      pagesPerCategory: parsed.data.pagesPerCategory ?? 4,
      delayMs: parsed.data.delayMs ?? 800
    });
    console.info({ event: "mercado_livre_catalog_server_sync", duration_ms: Date.now() - started, ...result });
    return NextResponse.json({ ok: true, duration_ms: Date.now() - started, ...result });
  } catch (error) {
    const code = error instanceof Error ? error.message : "MERCADO_LIVRE_HUB_UNAVAILABLE";
    console.error({ event: "mercado_livre_catalog_server_sync_failed", code });
    const expired = code === "MERCADO_LIVRE_SESSION_MISSING" || code === "MERCADO_LIVRE_SESSION_EXPIRED";
    return NextResponse.json({ ok: false, code }, { status: expired ? 409 : 503 });
  }
}
