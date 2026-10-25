"use client";

import { Flag, Heart, Lock, MessageCircle, Repeat2, Trash2, Coins } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Amount, Avatar, timeAgo } from "@/components/ui/bits";
import { useSession } from "@/lib/client/session";
import type { Post, PreparedIntent } from "@/lib/client/types";
import { useTx } from "@/lib/client/useTx";
import { TipModal } from "./TipModal";

export function PostCard({ post, onChange, onRemoved }: { post: Post; onChange?: () => void; onRemoved?: () => void }) {
  const { api, profile } = useSession();
  const { run } = useTx();
  const [p, setP] = useState(post);
  const [tipOpen, setTipOpen] = useState(false);
  const shown = p.original ?? p;
  const author = shown.author;
  const mine = shown.author_id === profile?.id;

  async function like() {
    const was = shown.liked;
    const upd = { ...shown, liked: !was, like_count: shown.like_count + (was ? -1 : 1) };
    setP(p.original ? { ...p, original: upd } : upd);
    try { await api(`/api/posts/${shown.id}/like`, { body: {} }); } catch { setP(p); }
  }

  return (
    <article className="mx-4 mb-3 rounded-3xl bg-white p-4 ring-1 ring-line transition-shadow hover:shadow-[0_12px_30px_-18px_rgba(16,27,45,0.35)] md:mx-6 md:p-5" aria-labelledby={`post-${p.id}`}>
      {p.original && <p className="mb-2 flex items-center gap-1.5 text-sm text-slate"><Repeat2 size={14} aria-hidden /> @{p.author?.username} reposted</p>}
      <div className="flex gap-3">
        <Link href={`/u/${author?.username}`} aria-label={`@${author?.username}`}><Avatar src={author?.avatar_url} name={author?.username} /></Link>
        <div className="min-w-0 flex-1">
          <div id={`post-${p.id}`} className="flex flex-wrap items-baseline gap-x-1.5">
            <Link href={`/u/${author?.username}`} className="font-semibold hover:underline">{author?.display_name ?? author?.username}</Link>
            <span className="text-sm text-slate">@{author?.username}</span>
            <Link href={`/p/${shown.id}`} className="text-sm text-slate hover:underline"><time dateTime={shown.created_at}>{timeAgo(shown.created_at)}</time></Link>
          </div>
          {shown.body && <p className="mt-1 whitespace-pre-wrap break-words">{shown.body}</p>}

          {shown.is_premium && (
            shown.unlocked ? (
              shown.premiumBody ? <div className="mt-3 whitespace-pre-wrap rounded-xl bg-mint-soft p-3 text-ink"><p className="mb-1 flex items-center gap-1.5 text-sm font-semibold text-mint-deep"><Lock size={14} aria-hidden /> Unlocked</p>{shown.premiumBody}</div> : null
            ) : (
              <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-ink p-4 text-white">
                <p className="flex items-center gap-2"><Lock size={16} aria-hidden /> Premium post</p>
                {shown.product && (
                  <button className="btn bg-mint text-ink hover:opacity-90"
                    onClick={() => run(() => api<PreparedIntent>("/api/purchases/prepare", { body: { postId: shown.id } }), { onConfirmed: () => { setTimeout(() => onChange?.(), 400); } })}>
                    Unlock for <Amount value={shown.product.price} asset={shown.product.asset} decimals={7} />
                  </button>
                )}
              </div>
            )
          )}

          {shown.media.length > 0 && (
            <div className={`mt-3 grid gap-2 ${shown.media.length > 1 ? "grid-cols-2" : ""}`}>
              {shown.media.map((m) =>
                m.locked || !m.url ? (
                  <div key={m.id} className="grid aspect-video place-items-center rounded-xl bg-ink/90 text-white/80"><Lock aria-label="Locked file" /></div>
                ) : m.mime.startsWith("image/") ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img key={m.id} src={m.url} alt="" loading="lazy" className="max-h-[28rem] w-full rounded-2xl object-cover" />
                ) : m.mime.startsWith("video/") ? (
                  <video key={m.id} src={m.url} controls preload="metadata" className="w-full rounded-xl" />
                ) : (
                  <a key={m.id} href={m.url} className="link rounded-xl bg-white p-3 ring-1 ring-line" target="_blank" rel="noreferrer">Download file</a>
                ),
              )}
            </div>
          )}

          <div className="-ml-3 mt-2 flex flex-wrap items-center text-slate">
            <button onClick={like} aria-pressed={shown.liked} aria-label={shown.liked ? "Unlike" : "Like"} className={`tap inline-flex items-center gap-1.5 rounded-full px-3 hover:bg-cobalt-soft ${shown.liked ? "text-danger" : ""}`}>
              <Heart size={18} fill={shown.liked ? "currentColor" : "none"} aria-hidden /> <span className="tabular text-sm">{shown.like_count}</span>
            </button>
            <Link href={`/p/${shown.id}`} aria-label="Comments" className="tap inline-flex items-center gap-1.5 rounded-full px-3 hover:bg-cobalt-soft">
              <MessageCircle size={18} aria-hidden /> <span className="tabular text-sm">{shown.comment_count}</span>
            </Link>
            <button aria-label="Repost" className="tap inline-flex items-center gap-1.5 rounded-full px-3 hover:bg-cobalt-soft" disabled={mine}
              onClick={async () => { try { await api(`/api/posts/${shown.id}/repost`, { body: {} }); onChange?.(); } catch (e) { alertInline(e); } }}>
              <Repeat2 size={18} aria-hidden /> <span className="tabular text-sm">{shown.repost_count}</span>
            </button>
            {!mine && (
              <button aria-label={`Tip @${author?.username}`} onClick={() => setTipOpen(true)} className="tap inline-flex items-center gap-1.5 rounded-full px-3 hover:bg-mint-soft hover:text-mint-deep">
                <Coins size={18} aria-hidden /> <span className="text-sm">Tip</span>
              </button>
            )}
            {Number(shown.tip_total_usdc) > 0 && <span className="px-2 text-sm"><Amount value={shown.tip_total_usdc} asset="USDC" /> tipped</span>}
            <span className="ml-auto" />
            {mine ? (
              <button aria-label="Delete post" className="tap inline-flex items-center justify-center rounded-full hover:bg-danger-soft hover:text-danger"
                onClick={async () => { if (confirmDelete()) { await api(`/api/posts/${p.id}`, { method: "DELETE" }); onRemoved?.(); } }}>
                <Trash2 size={17} />
              </button>
            ) : (
              <button aria-label="Report post" className="tap inline-flex items-center justify-center rounded-full hover:bg-cloud"
                onClick={async () => { const r = prompt("Why are you reporting this post?"); if (r && r.length >= 3) await api("/api/reports", { body: { entityType: "post", entityId: shown.id, reason: r } }); }}>
                <Flag size={16} />
              </button>
            )}
          </div>
        </div>
      </div>
      {author?.username && <TipModal open={tipOpen} onClose={() => setTipOpen(false)} postId={shown.id} username={author.username} onTipped={onChange} />}
    </article>
  );
}

function confirmDelete() {
  return typeof window !== "undefined" && window.confirm("Delete this post? Buyers keep their purchase records.");
}
function alertInline(e: unknown) {
  if (typeof window !== "undefined") window.alert((e as Error).message);
}
