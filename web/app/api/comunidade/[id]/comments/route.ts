import { NextRequest, NextResponse } from "next/server";
import { persistentRateLimit, requireAccountContext, requireValidOrigin } from "@/lib/security";
import { createCommentSchema } from "@/modules/comunidade/schemas";
import { addComment, listComments } from "@/modules/comunidade/server/service";
import { notify } from "@/modules/comunidade/server/notifications";
import { supabaseAdmin } from "@/lib/supabase";
import { serverError } from "@/shared/http/responses";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const context = await requireAccountContext();
  if (context.error) return context.error;
  const { id } = await params;
  try {
    const comments = await listComments(context.database, id);
    return NextResponse.json({ comments });
  } catch (error) { return serverError(error, "Não foi possível carregar os comentários."); }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const origin = requireValidOrigin(request);
  if (origin) return origin;
  const context = await requireAccountContext();
  if (context.error) return context.error;
  const parsed = createCommentSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Comentário inválido." }, { status: 400 });
  const allowed = await persistentRateLimit(context.session.userId!, "comunidade_comment", 30, 3600);
  if (!allowed) return NextResponse.json({ error: "Muitos comentários. Aguarde um pouco." }, { status: 429 });
  const { id } = await params;
  try {
    const comment = await addComment(context.database, context.accountId, context.session.userId!, id, parsed.data.content);
    const { data: post } = await context.database.from("community_posts").select("user_id").eq("id", id).maybeSingle();
    if (post?.user_id) {
      await notify(supabaseAdmin(), {
        recipientUserId: post.user_id, actorUserId: context.session.userId!,
        accountId: context.accountId, type: "comment", postId: id
      });
    }
    return NextResponse.json({ comment: { ...comment, author: { user_id: context.session.userId, name: context.session.name, email: context.session.email } } });
  } catch (error) { return serverError(error, "Não foi possível comentar."); }
}
