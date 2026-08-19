import { NextRequest, NextResponse } from "next/server";
import { requireAccountContext, requireAdmin, requireValidOrigin } from "@/lib/security";
import { ADMIN_POST_ACTIONS, postActionSchema } from "@/modules/comunidade/schemas";
import { applyPostAction, getPost } from "@/modules/comunidade/server/service";
import { serverError } from "@/shared/http/responses";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const context = await requireAccountContext();
  if (context.error) return context.error;
  const { id } = await params;
  try {
    const post = await getPost(context.database, id, context.session.userId);
    return post ? NextResponse.json({ post }) : NextResponse.json({ error: "Publicação não encontrada." }, { status: 404 });
  } catch (error) { return serverError(error, "Não foi possível carregar a publicação."); }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const origin = requireValidOrigin(request);
  if (origin) return origin;
  const parsed = postActionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Ação inválida." }, { status: 400 });
  const isAdminAction = ADMIN_POST_ACTIONS.has(parsed.data.action);
  if (isAdminAction) {
    const guard = await requireAdmin();
    if (guard) return guard;
  }
  const context = await requireAccountContext();
  if (context.error) return context.error;
  const { id } = await params;
  try {
    await applyPostAction({
      database: context.database, userId: context.session.userId!,
      isAdmin: context.session.role === "admin", postId: id, action: parsed.data
    });
    return NextResponse.json({ ok: true });
  } catch (error) { return serverError(error, "Não foi possível atualizar a publicação."); }
}
