import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { env } from "@/lib/env";
import { supabaseAdmin } from "@/lib/supabase";
import { affiliateLinkForEmail, integrationStatus, PilotoLinkError } from "@/modules/piloto-link/server/service";

// Servidor a servidor: o app do Piloto (app.comentei.com) pede o link de afiliado da aluna.
//   { email, url }  -> { link, marketplace }
//   { email }       -> quais integrações a aluna tem conectadas

const bodySchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  url: z.string().trim().url().max(2000).optional(),
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
  if (!parsed.success) return NextResponse.json({ error: "Informe e-mail e link válidos." }, { status: 400 });

  const database = supabaseAdmin({ timeoutMs: 15_000 });
  try {
    if (!parsed.data.url) return NextResponse.json(await integrationStatus(database, parsed.data.email));
    return NextResponse.json(await affiliateLinkForEmail(database, parsed.data.email, parsed.data.url));
  } catch (error) {
    if (error instanceof PilotoLinkError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    console.error({ event: "piloto_link_failed", component: "piloto-link", error_type: error instanceof Error ? error.name : "unknown" });
    return NextResponse.json({ error: "Não foi possível gerar o link agora.", code: "provider" }, { status: 500 });
  }
}
