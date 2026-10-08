import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { env } from "@/lib/env";
import { supabaseAdmin } from "@/lib/supabase";
import { dispatchTargets, PilotoLinkError, scheduleOfferForEmail } from "@/modules/piloto-link/server/service";

// Servidor a servidor: o app do Piloto manda o achadinho para os grupos de WhatsApp da aluna.
//   { email }                                         -> números e grupos dela
//   { email, url, senderId, groupJids, scheduledAt? } -> agenda o envio na fila do Disparei

const bodySchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  url: z.string().trim().url().max(2000).optional(),
  senderId: z.string().uuid().optional(),
  groupJids: z.array(z.string().min(5).max(120)).min(1).max(500).optional(),
  scheduledAt: z.string().datetime({ offset: true }).optional(),
});

function authorized(request: NextRequest, expected: string | undefined) {
  if (!expected) return false;
  const provided = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request: NextRequest) {
  const token = env().PILOTO_LINK_TOKEN;
  if (!token) return NextResponse.json({ error: "Integração do Piloto não configurada." }, { status: 503 });
  if (!authorized(request, token)) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Dados inválidos." }, { status: 400 });
  const { email, url, senderId, groupJids, scheduledAt } = parsed.data;

  const database = supabaseAdmin({ timeoutMs: 15_000 });
  try {
    if (!url) return NextResponse.json(await dispatchTargets(database, email));
    if (!senderId || !groupJids?.length) return NextResponse.json({ error: "Escolha o número e os grupos." }, { status: 400 });
    return NextResponse.json(await scheduleOfferForEmail(database, { email, url, senderId, groupJids, scheduledAt }));
  } catch (error) {
    if (error instanceof PilotoLinkError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    console.error({ event: "piloto_whatsapp_failed", component: "piloto-link", error_type: error instanceof Error ? error.name : "unknown" });
    return NextResponse.json({ error: "Não foi possível agendar agora.", code: "provider" }, { status: 500 });
  }
}
