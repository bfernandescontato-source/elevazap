import { NextRequest, NextResponse } from "next/server";
import { requireAccountContext, requireValidOrigin } from "@/lib/security";
import { markRead } from "@/modules/comunidade/server/notifications";
import { serverError } from "@/shared/http/responses";

export async function POST(request: NextRequest) {
  const origin = requireValidOrigin(request);
  if (origin) return origin;
  const context = await requireAccountContext();
  if (context.error) return context.error;
  const body = await request.json().catch(() => ({}));
  try {
    await markRead(context.database, context.session.userId!, body?.id);
    return NextResponse.json({ ok: true });
  } catch (error) { return serverError(error, "Não foi possível atualizar as notificações."); }
}
