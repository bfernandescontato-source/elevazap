"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2 } from "lucide-react";
import type { z } from "zod";
import { AppShell } from "@/components/ui";
import { ComunidadePostCard } from "@/components/comunidade-post-card";
import { ComunidadeCommentSection } from "@/components/comunidade-comment-section";
import { ComunidadeReportModal } from "@/components/comunidade-report-modal";
import type { postActionSchema } from "@/modules/comunidade/schemas";
import type { CommunityPost } from "@/modules/comunidade/types";

type CurrentUser = { user_id: string; email: string; name: string | null; avatar_url: string | null; role: "admin" | "operator" } | null;
type PostAction = z.infer<typeof postActionSchema>;

export default function ComunidadePostPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [post, setPost] = useState<CommunityPost | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [currentUser, setCurrentUser] = useState<CurrentUser>(null);
  const [reportOpen, setReportOpen] = useState(false);
  const [notice, setNotice] = useState("");

  useEffect(() => { fetch("/api/auth/me").then((response) => response.json()).then((body) => setCurrentUser(body.user || null)); }, []);

  const load = async () => {
    setLoading(true); setError("");
    try {
      const response = await fetch(`/api/comunidade/${id}`, { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      setPost(body.post);
    } catch (current) {
      setError(current instanceof Error ? current.message : "Não foi possível carregar a publicação.");
    } finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, [id]);

  const toggleLike = async () => {
    if (!post) return;
    const liked = !post.viewer_has_liked;
    setPost({ ...post, viewer_has_liked: liked, likes_count: post.likes_count + (liked ? 1 : -1) });
    const response = await fetch(`/api/comunidade/${post.id}/like`, { method: "POST" });
    if (!response.ok) await load();
  };

  const handleAction = async (target: CommunityPost, action: PostAction) => {
    const response = await fetch(`/api/comunidade/${target.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(action) });
    const body = await response.json();
    if (!response.ok) { setNotice(body.error || "Não foi possível concluir a ação."); return; }
    if (action.action === "delete_own" || action.action === "delete_any") { setPost(null); setNotice("Publicação excluída."); return; }
    await load();
  };

  return <AppShell
    title="Publicação"
    subtitle="Comunidade Disparei"
    action={<Link href="/comunidade" className="inline-flex h-10 items-center gap-2 rounded-lg border border-line bg-white px-4 text-sm font-medium text-ink"><ArrowLeft size={16} /> Voltar</Link>}
  >
    <div className="mx-auto max-w-2xl space-y-4">
      {notice ? <div className="rounded-lg bg-zinc-100 p-3 text-sm text-ink">{notice}</div> : null}
      {loading
        ? <div className="flex justify-center py-16"><Loader2 className="animate-spin text-muted" /></div>
        : error
        ? <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-center text-sm text-red-700">{error}</div>
        : !post
        ? <div className="rounded-lg border border-dashed border-line bg-panel p-10 text-center text-sm text-muted">Publicação não encontrada.</div>
        : <>
            <ComunidadePostCard post={post} currentUser={currentUser} onToggleLike={toggleLike} onAction={handleAction} onReport={() => setReportOpen(true)} />
            <ComunidadeCommentSection postId={post.id} currentUser={currentUser} onCountChange={(count) => setPost((current) => current ? { ...current, comments_count: count } : current)} />
          </>}
    </div>
    {reportOpen && post ? <ComunidadeReportModal postId={post.id} onClose={() => setReportOpen(false)} onDone={setNotice} /> : null}
  </AppShell>;
}
