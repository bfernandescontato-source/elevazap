import { NextRequest, NextResponse } from "next/server";
import { requireAccountContext, requireValidOrigin } from "@/lib/security";
import { commentActionSchema } from "@/modules/comunidade/schemas";
import { applyCommentAction } from "@/modules/comunidade/server/service";
import { serverError } from "@/shared/http/responses";

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string; commentId: string }> }) {
  const origin = requireValidOrigin(request);
  if (origin) return origin;
  const context = await requireAccountContext();
  if (context.error) return context.error;
  const parsed = commentActionSchema.safeParse(await request.json().catch(() => ({ action: "delete_own" })));
  if (!parsed.success) return NextResponse.json({ error: "Ação inválida." }, { status: 400 });
  const { commentId } = await params;
  try {
    await applyCommentAction({
      database: context.database, userId: context.session.userId!,
      isAdmin: context.session.role === "admin", commentId, action: parsed.data.action
    });
    return NextResponse.json({ ok: true });
  } catch (error) { return serverError(error, "Não foi possível excluir o comentário."); }
}
