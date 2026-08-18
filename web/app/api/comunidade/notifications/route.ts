import { NextResponse } from "next/server";
import { requireAccountContext } from "@/lib/security";
import { listNotifications } from "@/modules/comunidade/server/notifications";
import { serverError } from "@/shared/http/responses";

export async function GET() {
  const context = await requireAccountContext();
  if (context.error) return context.error;
  try {
    const result = await listNotifications(context.database, context.session.userId!);
    return NextResponse.json(result);
  } catch (error) { return serverError(error, "Não foi possível carregar as notificações."); }
}
