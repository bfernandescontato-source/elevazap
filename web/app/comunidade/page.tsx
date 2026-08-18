"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, MessageCircle, Plus } from "lucide-react";
import { AppShell } from "@/components/ui";
import { ComunidadeAvatar } from "@/components/comunidade-avatar";
import { ComunidadePostCard } from "@/components/comunidade-post-card";
import { ComunidadeNewPostModal } from "@/components/comunidade-new-post-modal";
import { ComunidadeReportModal } from "@/components/comunidade-report-modal";
import { communityCategories, postActionSchema } from "@/modules/comunidade/schemas";
import { CATEGORY_LABELS } from "@/modules/comunidade/constants";
import type { CommunityPost } from "@/modules/comunidade/types";
import type { z } from "zod";

type CurrentUser = { email: string; name: string | null; role: "admin" | "operator" } | null;
type PostAction = z.infer<typeof postActionSchema>;

export default function ComunidadePage() {
  const [posts, setPosts] = useState<CommunityPost[]>([]);
  const [page, setPage] = useState(1);
  const [hasNext, setHasNext] = useState(false);
  const [category, setCategory] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [more, setMore] = useState(false);
  const [error, setError] = useState("");
  const [currentUser, setCurrentUser] = useState<CurrentUser>(null);
  const [showNewPost, setShowNewPost] = useState(false);
  const [reportTarget, setReportTarget] = useState<CommunityPost | null>(null);
  const [notice, setNotice] = useState("");

  useEffect(() => { fetch("/api/auth/me").then((response) => response.json()).then((body) => setCurrentUser(body.user || null)); }, []);

  const load = useCallback(async (nextPage = 1, append = false) => {
    append ? setMore(true) : setLoading(true); setError("");
    const params = new URLSearchParams({ page: String(nextPage) });
    if (category) params.set("category", category);
    try {
      const response = await fetch(`/api/comunidade?${params}`, { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      setPosts((old) => append ? [...old, ...body.posts] : body.posts);
      setPage(body.pageInfo.page);
      setHasNext(body.pageInfo.hasNextPage);
    } catch (current) {
      setError(current instanceof Error ? current.message : "Não foi possível carregar a comunidade.");
      if (!append) setPosts([]);
    } finally { setLoading(false); setMore(false); }
  }, [category]);

  useEffect(() => { void load(); }, [load]);

  const toggleLike = async (post: CommunityPost) => {
    const liked = !post.viewer_has_liked;
    setPosts((current) => current.map((row) => row.id === post.id ? { ...row, viewer_has_liked: liked, likes_count: row.likes_count + (liked ? 1 : -1) } : row));
    const response = await fetch(`/api/comunidade/${post.id}/like`, { method: "POST" });
    if (!response.ok) setPosts((current) => current.map((row) => row.id === post.id ? post : row));
  };

  const handleAction = async (post: CommunityPost, action: PostAction) => {
    const response = await fetch(`/api/comunidade/${post.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(action) });
    const body = await response.json();
    if (!response.ok) { setNotice(body.error || "Não foi possível concluir a ação."); return; }
    if (action.action === "edit") {
      setPosts((current) => current.map((row) => row.id === post.id ? { ...row, content: action.content } : row));
      return;
    }
    await load(1);
  };

  return <AppShell
    title="Comunidade"
    subtitle="Aprenda, compartilhe e cresça junto com quem também está construindo operações de achadinhos."
    action={currentUser ? <button type="button" onClick={() => setShowNewPost(true)} className="inline-flex h-10 items-center gap-2 rounded-lg bg-black px-4 text-sm font-medium text-white hover:bg-zinc-800"><Plus size={16} /> Nova publicação</button> : undefined}
  >
    <div className="mx-auto max-w-2xl space-y-4">
      {currentUser ? <button type="button" onClick={() => setShowNewPost(true)} className="flex w-full items-center gap-3 rounded-lg border border-line bg-panel p-4 text-left shadow-soft hover:bg-wash">
        <ComunidadeAvatar name={currentUser.name} email={currentUser.email} />
        <span className="text-sm text-muted">Compartilhe algo com a comunidade...</span>
      </button> : null}

      <div className="flex gap-2 overflow-x-auto pb-1">
        <button onClick={() => setCategory(undefined)} className={`shrink-0 rounded-full border px-4 py-2 text-sm font-medium ${!category ? "border-black bg-black text-white" : "border-line bg-white text-muted"}`}>Todos</button>
        {communityCategories.map((value) => <button key={value} onClick={() => setCategory(value)} className={`shrink-0 rounded-full border px-4 py-2 text-sm font-medium ${category === value ? "border-black bg-black text-white" : "border-line bg-white text-muted"}`}>{CATEGORY_LABELS[value]}</button>)}
      </div>

      {notice ? <div className="rounded-lg bg-zinc-100 p-3 text-sm text-ink">{notice}</div> : null}

      {error
        ? <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-center"><p className="font-medium text-red-800">{error}</p><button onClick={() => load()} className="mt-4 rounded-lg bg-black px-4 py-2 text-sm text-white">Tentar novamente</button></div>
        : loading
        ? <FeedSkeleton />
        : !posts.length
        ? <div className="rounded-lg border border-dashed border-line bg-panel p-10 text-center">
            <MessageCircle className="mx-auto text-muted" />
            <h2 className="mt-3 font-semibold text-ink">A comunidade está começando agora 🚀</h2>
            <p className="mt-1 text-sm text-muted">Seja uma das primeiras pessoas a compartilhar uma estratégia, dúvida ou resultado.</p>
            {currentUser ? <button onClick={() => setShowNewPost(true)} className="mt-4 rounded-lg bg-black px-4 py-2 text-sm text-white">Criar publicação</button> : null}
          </div>
        : <>
            <div className="space-y-4">
              {posts.map((post) => <ComunidadePostCard key={post.id} post={post} currentUser={currentUser} href={`/comunidade/post/${post.id}`}
                truncate onToggleLike={toggleLike} onAction={handleAction} onReport={setReportTarget} />)}
            </div>
            {hasNext ? <div className="flex justify-center"><button disabled={more} onClick={() => load(page + 1, true)} className="inline-flex h-11 items-center gap-2 rounded-lg border border-line bg-white px-5 text-sm font-medium disabled:opacity-50">{more ? <Loader2 className="animate-spin" size={16} /> : null} Carregar mais</button></div> : null}
          </>}
    </div>

    {showNewPost ? <ComunidadeNewPostModal onClose={() => setShowNewPost(false)} onCreated={(post) => setPosts((current) => [post, ...current])} /> : null}
    {reportTarget ? <ComunidadeReportModal postId={reportTarget.id} onClose={() => setReportTarget(null)} onDone={setNotice} /> : null}
  </AppShell>;
}

function FeedSkeleton() {
  return <div className="space-y-4">{Array.from({ length: 4 }).map((_, index) => <div key={index} className="rounded-lg border border-line bg-panel p-4">
    <div className="flex items-center gap-3"><div className="h-10 w-10 animate-pulse rounded-full bg-zinc-100" /><div className="space-y-2"><div className="h-3 w-32 animate-pulse rounded bg-zinc-100" /><div className="h-3 w-20 animate-pulse rounded bg-zinc-100" /></div></div>
    <div className="mt-4 space-y-2">{["h-3 w-full", "h-3 w-5/6", "h-3 w-2/3"].map((cls, j) => <div key={j} className={`${cls} animate-pulse rounded bg-zinc-100`} />)}</div>
  </div>)}</div>;
}
