import { NextRequest, NextResponse } from "next/server";
import { guardAdminMutation, requireAccountContext } from "@/lib/security";
import { statusPostSchema } from "@/modules/offer-story/schemas";
import { STATUS_DAILY_LIMIT, StatusPostError, createStatusPost, isWhatsappStatusEnabled } from "@/modules/offer-story/server/status-post-service";

export const runtime = "nodejs";

/** A tela só mostra "Postar no Status" para contas liberadas. */
export async function GET() {
  const context = await requireAccountContext(); if (context.error) return context.error;
  return NextResponse.json({ enabled: await isWhatsappStatusEnabled(context.accountId), dailyLimit: STATUS_DAILY_LIMIT });
}

export async function POST(request: NextRequest) {
  const guard = await guardAdminMutation(request, "catalog_status_ip"); if (guard) return guard;
  const context = await requireAccountContext(); if (context.error) return context.error;
  const parsed = statusPostSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || "Dados inválidos." }, { status: 400 });
  try {
    const result = await createStatusPost({ ...parsed.data, accountId: context.accountId });
    return NextResponse.json({ ok: true, loteId: result.loteId });
  } catch (error) {
    if (error instanceof StatusPostError) return NextResponse.json({ error: error.message }, { status: error.status });
    throw error;
  }
}
