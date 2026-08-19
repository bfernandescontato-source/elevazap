import { NextRequest, NextResponse } from "next/server";
import { persistentRateLimit, requireAccountContext, requireValidOrigin } from "@/lib/security";
import { createPostSchema, listPostsQuerySchema } from "@/modules/comunidade/schemas";
import { createPost, getPost, listPosts } from "@/modules/comunidade/server/service";
import { serverError } from "@/shared/http/responses";

export async function GET(request: NextRequest) {
  const context = await requireAccountContext();
  if (context.error) return context.error;
  const parsed = listPostsQuerySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!parsed.success) return NextResponse.json({ error: "Parâmetros inválidos." }, { status: 400 });
  try {
    const result = await listPosts(context.database, { ...parsed.data, viewerUserId: context.session.userId });
    return NextResponse.json(result);
  } catch (error) { return serverError(error, "Não foi possível carregar a comunidade."); }
}

export async function POST(request: NextRequest) {
  const origin = requireValidOrigin(request);
  if (origin) return origin;
  const context = await requireAccountContext();
  if (context.error) return context.error;
  const parsed = createPostSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || "Publicação inválida." }, { status: 400 });
  const allowed = await persistentRateLimit(context.session.userId!, "comunidade_post", 10, 3600);
  if (!allowed) return NextResponse.json({ error: "Muitas publicações. Aguarde um pouco antes de postar de novo." }, { status: 429 });
  try {
    const created = await createPost(context.database, context.accountId, context.session.userId!, parsed.data);
    const post = await getPost(context.database, created.id, context.session.userId);
    return NextResponse.json({ post });
  } catch (error) { return serverError(error, "Não foi possível publicar."); }
}
