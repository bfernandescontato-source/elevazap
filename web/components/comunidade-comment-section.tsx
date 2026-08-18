"use client";

import { useEffect, useState } from "react";
import { Loader2, Send, Trash2 } from "lucide-react";
import { ComunidadeAvatar } from "./comunidade-avatar";
import { timeAgo } from "@/modules/comunidade/constants";
import type { CommunityComment } from "@/modules/comunidade/types";

type CurrentUser = { email: string; name: string | null; role: "admin" | "operator" } | null;

export function ComunidadeCommentSection({ postId, currentUser, onCountChange }: {
  postId: string; currentUser: CurrentUser; onCountChange?: (count: number) => void;
}) {
  const [comments, setComments] = useState<CommunityComment[]>([]);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    setLoading(true);
    fetch(`/api/comunidade/${postId}/comments`, { cache: "no-store" })
      .then((response) => response.json())
      .then((body) => { if (alive) { setComments(body.comments || []); onCountChange?.((body.comments || []).length); } })
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [postId]);

  const submit = async () => {
    if (!text.trim()) return;
    setSending(true); setError("");
    try {
      const response = await fetch(`/api/comunidade/${postId}/comments`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ content: text.trim() })
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      setComments((current) => { const next = [...current, body.comment]; onCountChange?.(next.length); return next; });
      setText("");
    } catch (current) {
      setError(current instanceof Error ? current.message : "Não foi possível comentar.");
    } finally { setSending(false); }
  };

  const remove = async (comment: CommunityComment) => {
    const isOwner = Boolean(currentUser?.email && comment.author.email && currentUser.email === comment.author.email);
    const response = await fetch(`/api/comunidade/${postId}/comments/${comment.id}`, {
      method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: isOwner ? "delete_own" : "delete_any" })
    });
    if (response.ok) setComments((current) => { const next = current.filter((row) => row.id !== comment.id); onCountChange?.(next.length); return next; });
  };

  return <div className="rounded-lg border border-line bg-panel p-4 shadow-soft">
    <h3 className="text-sm font-semibold text-ink">Comentários</h3>
    {loading ? <div className="mt-3 flex justify-center py-4"><Loader2 className="animate-spin text-muted" size={18} /></div> : <div className="mt-3 space-y-3">
      {comments.map((comment) => {
        const isOwner = Boolean(currentUser?.email && comment.author.email && currentUser.email === comment.author.email);
        const canDelete = isOwner || currentUser?.role === "admin";
        return <div key={comment.id} className="flex items-start gap-2.5">
          <ComunidadeAvatar name={comment.author.name} email={comment.author.email} size={32} />
          <div className="min-w-0 flex-1 rounded-lg bg-wash px-3 py-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-semibold text-ink">{comment.author.name || comment.author.email || "Usuário Disparei"}</span>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted">{timeAgo(comment.created_at)}</span>
                {canDelete ? <button type="button" onClick={() => remove(comment)} className="text-muted hover:text-red-600"><Trash2 size={13} /></button> : null}
              </div>
            </div>
            <p className="mt-0.5 whitespace-pre-wrap text-sm text-ink">{comment.content}</p>
          </div>
        </div>;
      })}
      {!comments.length ? <p className="py-2 text-sm text-muted">Seja o primeiro a comentar.</p> : null}
    </div>}
    {currentUser ? <div className="mt-3 flex items-center gap-2">
      <input value={text} onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void submit(); } }}
        maxLength={2000} placeholder="Escreva um comentário..." className="focus-ring h-10 flex-1 rounded-lg border border-line bg-white px-3 text-sm" />
      <button type="button" disabled={sending || !text.trim()} onClick={submit} className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-black text-white disabled:opacity-50">
        {sending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
      </button>
    </div> : null}
    {error ? <p className="mt-2 text-sm text-red-700">{error}</p> : null}
  </div>;
}
