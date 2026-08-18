import { NextRequest, NextResponse } from "next/server";
import { requireAccountContext, requireValidOrigin } from "@/lib/security";
import { toggleLike } from "@/modules/comunidade/server/service";
import { notify } from "@/modules/comunidade/server/notifications";
import { supabaseAdmin } from "@/lib/supabase";
import { serverError } from "@/shared/http/responses";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const origin = requireValidOrigin(request);
  if (origin) return origin;
  const context = await requireAccountContext();
  if (context.error) return context.error;
  const { id } = await params;
  try {
    const result = await toggleLike(context.database, context.accountId, context.session.userId!, id);
    if (result.liked) {
      const { data: post } = await context.database.from("community_posts").select("user_id").eq("id", id).maybeSingle();
      if (post?.user_id) {
        await notify(supabaseAdmin(), {
          recipientUserId: post.user_id, actorUserId: context.session.userId!,
          accountId: context.accountId, type: "like", postId: id
        });
      }
    }
    return NextResponse.json(result);
  } catch (error) { return serverError(error, "Não foi possível curtir a publicação."); }
}
