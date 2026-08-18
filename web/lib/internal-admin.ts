import { NextRequest, NextResponse } from "next/server";
import { env } from "./env";
import { getSession, type AppSession } from "./auth";
import { clientIp, persistentRateLimit, requireValidOrigin } from "./security";

// Distinto de AppSession.role: role "admin" é por conta/tenant. Este módulo é
// restrito ao único e-mail do administrador da plataforma (ADMIN_EMAIL).
export function isInternalAdmin(session: Pick<AppSession, "email"> | null | undefined) {
  if (!session?.email) return false;
  return session.email.toLowerCase() === env().ADMIN_EMAIL.toLowerCase();
}

export async function requireInternalAdmin() {
  const session = await getSession();
  if (!session) return { error: NextResponse.json({ error: "Não autorizado." }, { status: 401 }) };
  if (!isInternalAdmin(session)) return { error: NextResponse.json({ error: "Acesso restrito ao administrador da plataforma." }, { status: 403 }) };
  return { session };
}

export async function guardInternalAdminMutation(request: NextRequest, scope = "internal_admin_action_ip") {
  const guard = await requireInternalAdmin();
  if (guard.error) return guard.error;
  const origin = requireValidOrigin(request);
  if (origin) return origin;
  const allowed = await persistentRateLimit(clientIp(request), scope, 30, 60);
  if (!allowed) return NextResponse.json({ error: "Muitas tentativas. Aguarde um pouco." }, { status: 429 });
  return null;
}
