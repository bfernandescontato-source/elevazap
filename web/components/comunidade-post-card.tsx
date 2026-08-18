"use client";

import { ReactNode, useState } from "react";
import Link from "next/link";
import type { z } from "zod";
import { Heart, MessageCircle, MoreVertical, Pin, ShieldCheck } from "lucide-react";
import { ConfirmModal } from "@/components/ui";
import { ComunidadeAvatar } from "./comunidade-avatar";
import { ComunidadeCategoryBadge } from "./comunidade-category-badge";
import { linkify } from "@/modules/comunidade/linkify";
import { MARKETPLACE_LABELS, money, timeAgo } from "@/modules/comunidade/constants";
import type { postActionSchema } from "@/modules/comunidade/schemas";
import type { CommunityPost } from "@/modules/comunidade/types";

type PostAction = z.infer<typeof postActionSchema>;
type CurrentUser = { user_id: string; email: string; name: string | null; avatar_url?: string | null; role: "admin" | "operator" } | null;

export function ComunidadePostCard({
  post, currentUser, href, truncate = false, onToggleLike, onAction, onReport
}: {
  post: CommunityPost; currentUser: CurrentUser; href?: string; truncate?: boolean;
  onToggleLike: (post: CommunityPost) => void;
  onAction: (post: CommunityPost, action: PostAction) => Promise<void>;
  onReport: (post: CommunityPost) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [content, setContent] = useState(post.content);
  const [confirm, setConfirm] = useState<null | "delete_own" | "delete_any">(null);
  const [busy, setBusy] = useState(false);

  const isOwner = Boolean(currentUser?.user_id && post.user_id === currentUser.user_id);
  const isAdmin = currentUser?.role === "admin";

  const run = async (action: PostAction) => {
    setBusy(true);
    try { await onAction(post, action); } finally { setBusy(false); setMenuOpen(false); }
  };

  const authorName = post.is_official ? "Equipe Disparei" : (post.author.name || post.author.email || "Usuário Disparei");

  return <article className="rounded-lg border border-line bg-panel p-4 shadow-soft">
    <div className="flex items-start gap-3">
      <ComunidadeAvatar name={post.is_official ? "Equipe Disparei" : post.author.name} email={post.author.email} avatarUrl={post.is_official ? null : post.author.avatar_url} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="font-semibold text-ink">{authorName}</span>
          {post.is_official ? <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-blue-700"><ShieldCheck size={12} /> Oficial</span> : null}
          {post.is_pinned ? <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700"><Pin size={12} /> Fixado</span> : null}
        </div>
        <div className="mt-0.5 flex items-center gap-2 text-xs text-muted">
          <span>{timeAgo(post.created_at)}</span>
          <ComunidadeCategoryBadge category={post.category} />
        </div>
      </div>
      {currentUser ? <div className="relative">
        <button type="button" onClick={() => setMenuOpen((open) => !open)} className="grid h-8 w-8 place-items-center rounded-lg text-muted hover:bg-wash"><MoreVertical size={16} /></button>
        {menuOpen ? <div className="absolute right-0 top-9 z-10 w-48 rounded-lg border border-line bg-white py-1 shadow-soft" onMouseLeave={() => setMenuOpen(false)}>
          {isOwner ? <>
            <MenuItem onClick={() => { setEditing(true); setMenuOpen(false); }}>Editar</MenuItem>
            <MenuItem onClick={() => { setConfirm("delete_own"); setMenuOpen(false); }} destructive>Excluir</MenuItem>
          </> : <MenuItem onClick={() => { onReport(post); setMenuOpen(false); }}>Denunciar</MenuItem>}
          {isAdmin ? <>
            <div className="my-1 border-t border-line" />
            <MenuItem onClick={() => run({ action: post.is_pinned ? "unpin" : "pin" })}>{post.is_pinned ? "Desfixar" : "Fixar"}</MenuItem>
            <MenuItem onClick={() => run({ action: post.is_official ? "unmark_official" : "mark_official" })}>{post.is_official ? "Remover oficial" : "Marcar oficial"}</MenuItem>
            <MenuItem onClick={() => run({ action: post.is_hidden ? "unhide" : "hide" })}>{post.is_hidden ? "Reexibir" : "Ocultar"}</MenuItem>
            {!isOwner ? <MenuItem onClick={() => { setConfirm("delete_any"); setMenuOpen(false); }} destructive>Excluir (admin)</MenuItem> : null}
          </> : null}
        </div> : null}
      </div> : null}
    </div>

    {editing ? <div className="mt-3">
      <textarea value={content} onChange={(event) => setContent(event.target.value)} maxLength={5000} rows={4} className="focus-ring w-full resize-none rounded-lg border border-line bg-white p-3 text-sm" />
      <div className="mt-2 flex justify-end gap-2">
        <button type="button" className="rounded-lg border border-line px-3 py-1.5 text-sm" onClick={() => { setEditing(false); setContent(post.content); }}>Cancelar</button>
        <button type="button" disabled={busy} className="rounded-lg bg-black px-3 py-1.5 text-sm text-white disabled:opacity-50" onClick={async () => { await run({ action: "edit", content }); setEditing(false); }}>Salvar</button>
      </div>
    </div> : <p className={`mt-3 whitespace-pre-wrap text-sm text-ink ${truncate ? "line-clamp-6" : ""}`}>{linkify(post.content)}</p>}

    {post.image_urls.length ? <div className={`mt-3 grid gap-1 overflow-hidden rounded-lg ${post.image_urls.length === 1 ? "grid-cols-1" : "grid-cols-2"}`}>
      {post.image_urls.map((url, index) => <img key={index} src={url} alt="" className="h-full max-h-96 w-full object-cover" />)}
    </div> : null}

    {post.category === "resultado" && (post.result_amount_cents != null || post.result_marketplace) ? <div className="mt-3 rounded-lg border border-emerald-100 bg-emerald-50 p-3">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-emerald-700">Resultado declarado</div>
      <div className="mt-1 flex items-end justify-between">
        {post.result_amount_cents != null ? <strong className="text-lg text-emerald-700">{money(post.result_amount_cents)}</strong> : <span />}
        {post.result_marketplace ? <span className="text-xs font-medium text-emerald-700">{MARKETPLACE_LABELS[post.result_marketplace] || post.result_marketplace}</span> : null}
      </div>
    </div> : null}

    <div className="mt-4 flex items-center gap-4 border-t border-line pt-3 text-sm text-muted">
      <button type="button" onClick={() => currentUser && onToggleLike(post)} disabled={!currentUser} className={`inline-flex items-center gap-1.5 ${post.viewer_has_liked ? "text-red-600" : "hover:text-ink"}`}>
        <Heart size={16} fill={post.viewer_has_liked ? "currentColor" : "none"} /> {post.likes_count}
      </button>
      {href
        ? <Link href={href} className="inline-flex items-center gap-1.5 hover:text-ink"><MessageCircle size={16} /> {post.comments_count}</Link>
        : <span className="inline-flex items-center gap-1.5"><MessageCircle size={16} /> {post.comments_count}</span>}
    </div>

    <ConfirmModal
      open={confirm !== null} title="Excluir publicação" confirmLabel="Excluir" destructive loading={busy}
      onCancel={() => setConfirm(null)}
      onConfirm={async () => { if (confirm) await run({ action: confirm }); setConfirm(null); }}
    >
      Essa ação não pode ser desfeita.
    </ConfirmModal>
  </article>;
}

function MenuItem({ children, onClick, destructive = false }: { children: ReactNode; onClick: () => void; destructive?: boolean }) {
  return <button type="button" onClick={onClick} className={`block w-full px-3 py-2 text-left text-sm hover:bg-wash ${destructive ? "text-red-600" : "text-ink"}`}>{children}</button>;
}
