import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/lib/supabase";
import type { CommunityAuthor } from "../types";
import type { postActionSchema } from "../schemas";
import { z } from "zod";

const POST_SELECT = "id,account_id,user_id,content,category,is_official,is_pinned,is_hidden,image_paths,result_amount_cents,result_marketplace,created_at,updated_at";
const POST_SELECT_WITH_COUNTS = `${POST_SELECT}, likes:community_likes(count), comments:community_comments(count)`;

export async function attachAuthors(database: SupabaseClient, rows: Array<{ user_id: string | null }>) {
  const userIds = Array.from(new Set(rows.map((row) => row.user_id).filter((id): id is string => Boolean(id))));
  const authors = new Map<string, { name: string | null; email: string | null }>();
  if (!userIds.length) return authors;
  const { data, error } = await database.from("app_users").select("id,name,email").in("id", userIds);
  if (error) throw error;
  for (const user of data || []) authors.set(user.id, { name: user.name, email: user.email });
  return authors;
}

function authorFor(userId: string | null, authors: Map<string, { name: string | null; email: string | null }>): CommunityAuthor {
  return { user_id: userId, ...(authors.get(userId || "") || { name: null, email: null }) };
}

async function signedImageUrls(admin: SupabaseClient, paths: string[]) {
  if (!paths.length) return [] as string[];
  const urls = await Promise.all(paths.map(async (path) => {
    const { data } = await admin.storage.from("community-media").createSignedUrl(path, 3600);
    return data?.signedUrl || null;
  }));
  return urls.filter((url): url is string => Boolean(url));
}

function withCounts<T extends { likes?: { count: number }[]; comments?: { count: number }[] }>(post: T) {
  return { likes_count: post.likes?.[0]?.count || 0, comments_count: post.comments?.[0]?.count || 0 };
}

export async function listPosts(database: SupabaseClient, params: { page: number; category?: string; viewerUserId: string | null }) {
  const limit = 20;
  const from = (params.page - 1) * limit;
  let query = database.from("community_posts")
    .select(POST_SELECT_WITH_COUNTS, { count: "exact" })
    .is("deleted_at", null).eq("is_hidden", false)
    .order("is_pinned", { ascending: false }).order("created_at", { ascending: false })
    .range(from, from + limit - 1);
  if (params.category) query = query.eq("category", params.category);
  const { data, error, count } = await query;
  if (error) throw error;
  const posts = data || [];
  const admin = supabaseAdmin();
  const postIds = posts.map((post) => post.id);
  const [authors, viewerLikes] = await Promise.all([
    attachAuthors(database, posts),
    params.viewerUserId && postIds.length
      ? database.from("community_likes").select("post_id").eq("user_id", params.viewerUserId).in("post_id", postIds)
      : Promise.resolve({ data: [] as { post_id: string }[] })
  ]);
  const likedSet = new Set((viewerLikes.data || []).map((row) => row.post_id));
  const enriched = await Promise.all(posts.map(async (post) => ({
    ...post,
    image_urls: await signedImageUrls(admin, post.image_paths || []),
    author: authorFor(post.user_id, authors),
    ...withCounts(post),
    viewer_has_liked: likedSet.has(post.id)
  })));
  return { posts: enriched, pageInfo: { page: params.page, limit, hasNextPage: (count || 0) > from + limit } };
}

export async function getPost(database: SupabaseClient, postId: string, viewerUserId: string | null) {
  const { data: post, error } = await database.from("community_posts")
    .select(POST_SELECT_WITH_COUNTS).eq("id", postId).is("deleted_at", null).maybeSingle();
  if (error) throw error;
  if (!post) return null;
  const admin = supabaseAdmin();
  const [authors, imageUrls, viewerLiked, comments] = await Promise.all([
    attachAuthors(database, [post]),
    signedImageUrls(admin, post.image_paths || []),
    viewerUserId ? database.from("community_likes").select("id").eq("post_id", postId).eq("user_id", viewerUserId).maybeSingle() : Promise.resolve({ data: null }),
    listComments(database, postId)
  ]);
  return {
    ...post,
    image_urls: imageUrls,
    author: authorFor(post.user_id, authors),
    ...withCounts(post),
    viewer_has_liked: Boolean(viewerLiked.data),
    comments
  };
}

export async function createPost(database: SupabaseClient, accountId: string, userId: string, input: {
  content: string; category: string; image_paths: string[]; result_amount_cents?: number | null; result_marketplace?: string | null;
}) {
  const { data, error } = await database.from("community_posts").insert({
    account_id: accountId, user_id: userId, content: input.content, category: input.category,
    image_paths: input.image_paths, result_amount_cents: input.result_amount_cents ?? null,
    result_marketplace: input.result_marketplace ?? null
  }).select(POST_SELECT).single();
  if (error) throw error;
  return data;
}

export async function applyPostAction(params: {
  database: SupabaseClient; userId: string; isAdmin: boolean; postId: string; action: z.infer<typeof postActionSchema>;
}) {
  const { database, userId, isAdmin, postId, action } = params;
  const now = new Date().toISOString();

  if (action.action === "edit") {
    const { error, count } = await database.from("community_posts")
      .update({ content: action.content, updated_at: now }, { count: "exact" }).eq("id", postId).eq("user_id", userId);
    if (error) throw error;
    if (!count) throw new Error("Publicação não encontrada ou sem permissão.");
    return;
  }
  if (action.action === "delete_own") {
    const { error, count } = await database.from("community_posts")
      .update({ deleted_at: now, updated_at: now }, { count: "exact" }).eq("id", postId).eq("user_id", userId);
    if (error) throw error;
    if (!count) throw new Error("Publicação não encontrada ou sem permissão.");
    return;
  }
  if (!isAdmin) throw new Error("Apenas administradores podem realizar esta ação.");
  const patch: Record<string, unknown> = { updated_at: now };
  if (action.action === "delete_any") patch.deleted_at = now;
  if (action.action === "hide") patch.is_hidden = true;
  if (action.action === "unhide") patch.is_hidden = false;
  if (action.action === "pin") patch.is_pinned = true;
  if (action.action === "unpin") patch.is_pinned = false;
  if (action.action === "mark_official") patch.is_official = true;
  if (action.action === "unmark_official") patch.is_official = false;
  const { error, count } = await supabaseAdmin().from("community_posts").update(patch, { count: "exact" }).eq("id", postId);
  if (error) throw error;
  if (!count) throw new Error("Publicação não encontrada.");
}

export async function listComments(database: SupabaseClient, postId: string) {
  const { data, error } = await database.from("community_comments")
    .select("id,post_id,user_id,content,created_at")
    .eq("post_id", postId).is("deleted_at", null).order("created_at", { ascending: true });
  if (error) throw error;
  const authors = await attachAuthors(database, data || []);
  return (data || []).map((row) => ({ ...row, author: authorFor(row.user_id, authors) }));
}

export async function addComment(database: SupabaseClient, accountId: string, userId: string, postId: string, content: string) {
  const { data, error } = await database.from("community_comments")
    .insert({ post_id: postId, account_id: accountId, user_id: userId, content })
    .select("id,post_id,user_id,content,created_at").single();
  if (error) throw error;
  return data;
}

export async function applyCommentAction(params: { database: SupabaseClient; userId: string; isAdmin: boolean; commentId: string; action: "delete_own" | "delete_any" }) {
  const { database, userId, isAdmin, commentId, action } = params;
  const now = new Date().toISOString();
  if (action === "delete_own") {
    const { error, count } = await database.from("community_comments")
      .update({ deleted_at: now, updated_at: now }, { count: "exact" }).eq("id", commentId).eq("user_id", userId);
    if (error) throw error;
    if (!count) throw new Error("Comentário não encontrado ou sem permissão.");
    return;
  }
  if (!isAdmin) throw new Error("Apenas administradores podem realizar esta ação.");
  const { error, count } = await supabaseAdmin().from("community_comments")
    .update({ deleted_at: now, updated_at: now }, { count: "exact" }).eq("id", commentId);
  if (error) throw error;
  if (!count) throw new Error("Comentário não encontrado.");
}

export async function toggleLike(database: SupabaseClient, accountId: string, userId: string, postId: string) {
  const { data: existing, error: lookupError } = await database.from("community_likes")
    .select("id").eq("post_id", postId).eq("user_id", userId).maybeSingle();
  if (lookupError) throw lookupError;
  if (existing) {
    const { error } = await database.from("community_likes").delete().eq("id", existing.id);
    if (error) throw error;
    return { liked: false };
  }
  const { error } = await database.from("community_likes").insert({ post_id: postId, account_id: accountId, user_id: userId });
  if (error) throw error;
  return { liked: true };
}

export async function addReport(database: SupabaseClient, accountId: string, userId: string, postId: string, input: { reason: string; details?: string }) {
  const { error } = await database.from("community_reports").insert({
    post_id: postId, account_id: accountId, reporter_user_id: userId, reason: input.reason, details: input.details || null
  });
  if (error) throw error;
}
