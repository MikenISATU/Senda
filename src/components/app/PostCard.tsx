"use client";

import { useDialog } from "@/components/ui/Dialogs";
import { BadgeCheck, Flag, Gem, Heart, MessageCircle, Repeat2, Trash2, Coins } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Amount, Avatar, timeAgo } from "@/components/ui/bits";
import { useSession } from "@/lib/client/session";
import type { Post, PreparedIntent } from "@/lib/client/types";
import { useTx } from "@/lib/client/useTx";
import { TipModal } from "./TipModal";

export function PostCard({ post, onChange, onRemoved }: { post: Post; onChange?: () => void; onRemoved?: () => void }) {
  const { api, profile } = useSession();
  const dialog = useDialog();
  const { run } = useTx();
  const [p, setP] = useState(post);
  const [tipOpen, setTipOpen] = useState(false);
  const shown = p.original ?? p;
  const author = shown.author;
  const mine = shown.author_id === profile?.id;
  const amt = shown.product ? Number(shown.product.price).toFixed(2).replace(/\.00$/, "") : "";
  const price = !shown.product ? "" : shown.product.asset === "USDC" ? `$${amt}` : `${amt} ${shown.product.asset}`;

  async function like() {
    const was = shown.liked;
    const upd = { ...shown, liked: !was, like_count: shown.like_count + (was ? -1 : 1) };
    setP(p.original ? { ...p, original: upd } : upd);
    try { await api(`/api/posts/${shown.id}/like`, { body: {} }); } catch { setP(p); }
  }

  return (
    <article className="mx-4 mb-4 overflow-hidden rounded-[1.75rem] bg-white ring-1 ring-line md:mx-6" aria-labelledby={`post-${p.id}`}>
      {p.original && <p className="flex items-center gap-1.5 px-4 pt-3 text-sm text-slate md:px-5"><Repeat2 size={14} aria-hidden /> @{p.author?.username} shared this</p>}
      <header className="flex items-center gap-3 px-4 pb-3 pt-4 md:px-5">
        <Link href={`/u/${author?.username}`} aria-label={`@${author?.username}`} className="ring-grad shrink-0">
          <span className="block rounded-full bg-white p-0.5"><Avatar src={author?.avatar_url} name={author?.username} size={40} /></span>
        </Link>
        <div id={`post-${p.id}`} className="min-w-0 flex-1 leading-tight">
          <Link href={`/u/${author?.username}`} className="block truncate font-semibold hover:underline">{author?.display_name ?? author?.username}</Link>
          <span className="text-sm text-slate">@{author?.username} · <Link href={`/p/${shown.id}`} className="hover:underline"><time dateTime={shown.created_at}>{timeAgo(shown.created_at)}</time></Link></span>
        </div>
        {!mine && (
          <button aria-label={`Tip @${author?.username}`} onClick={() => setTipOpen(true)} className="btn-primary h-10 min-h-0 px-4 text-sm">
            <Coins size={16} aria-hidden /> Tip
          </button>
        )}
        {mine ? (
          <button aria-label="Delete post" className="icon-btn size-10 ring-0 hover:text-danger"
            onClick={async () => {
              const yes = await dialog.confirm({ title: "Delete this post?", message: "It will be removed from the feed. People who bought it keep it.", confirmLabel: "Delete", cancelLabel: "Keep it", tone: "danger" });
              if (!yes) return;
              try { await api(`/api/posts/${p.id}`, { method: "DELETE" }); onRemoved?.(); } catch (e) { dialog.error(e); }
            }}>
            <Trash2 size={17} />
          </button>
        ) : (
          <button aria-label="Report post" className="icon-btn size-10 ring-0 text-slate"
            onClick={async () => {
              const reason = await dialog.ask({
                title: "Report this post", message: "Tell us what's wrong. Only the Senda team sees this.",
                options: REPORT_REASONS, label: "What's the problem?", placeholder: "Pick one above or write your own", minLength: 3, maxLength: 500, confirmLabel: "Send report",
              });
              if (!reason) return;
              try {
                await api("/api/reports", { body: { entityType: "post", entityId: shown.id, reason } });
                dialog.notify({ title: "Report sent", message: "Thanks for telling us. We'll take a look." });
              } catch (e) { dialog.error(e); }
            }}>
            <Flag size={16} />
          </button>
        )}
      </header>

      {shown.media.length > 0 && (
        <div className={`grid gap-0.5 ${shown.media.length > 1 ? "grid-cols-2" : ""}`}>
          {shown.media.map((m) =>
            !m.url ? null : m.mime.startsWith("image/") ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={m.id} src={m.url} alt="" loading="lazy" className="max-h-[34rem] w-full object-cover" />
            ) : m.mime.startsWith("video/") ? (
              <video key={m.id} src={m.url} controls preload="metadata" className="w-full" />
            ) : (
              <a key={m.id} href={m.url} className="link m-4 rounded-xl bg-cloud p-3" target="_blank" rel="noreferrer">Download file</a>
            ),
          )}
        </div>
      )}

      <div className="px-4 pb-3 pt-3 md:px-5">
        {shown.status === "removed" && <p className="mb-1 text-sm font-semibold text-slate">Removed from the feed. You still own it.</p>}
        {shown.body && <p className="whitespace-pre-wrap break-words text-[15px]">{shown.body}</p>}

        {shown.premiumBody && <p className="mt-2 whitespace-pre-wrap break-words text-[15px]">{shown.premiumBody}</p>}

        {shown.is_premium && shown.product && (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-cloud p-3 ring-1 ring-line">
            <p className="flex min-w-0 items-center gap-2 text-sm font-semibold">
              <span className="grad grid size-8 shrink-0 place-items-center rounded-xl"><Gem size={16} aria-hidden /></span>
              <span className="min-w-0">
                <span className="block">{mine ? "For sale" : shown.owned ? "You own this post" : "Premium post"}</span>
                <span className="block text-xs font-normal text-slate">{shown.owners === 0 ? "No owners yet" : shown.owners === 1 ? "1 owner" : `${shown.owners} owners`}</span>
              </span>
            </p>
            {mine ? (
              <span className="rounded-full bg-white px-3 py-1.5 text-sm font-bold ring-1 ring-line">{price}</span>
            ) : shown.owned ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-mint-soft px-3 py-1.5 text-sm font-bold text-mint-deep"><BadgeCheck size={16} aria-hidden /> Owned</span>
            ) : shown.status === "active" ? (
              <button className="btn-primary h-10 min-h-0 px-4 text-sm"
                onClick={() => run(() => api<PreparedIntent>("/api/purchases/prepare", { body: { postId: shown.id, price: shown.product!.price } }), { onConfirmed: () => { setTimeout(() => onChange?.(), 400); } })}>
                Buy for {price}
              </button>
            ) : null}
            {shown.ownerList?.length > 0 && (
              <p className="flex w-full flex-wrap items-center gap-x-1.5 gap-y-1 border-t border-line pt-2.5 text-sm text-slate">
                <span className="mr-1 flex -space-x-2">
                  {shown.ownerList.slice(0, 3).map((o) => <span key={o.username} className="rounded-full ring-2 ring-cloud"><Avatar src={o.avatar_url} name={o.username} size={22} /></span>)}
                </span>
                Owned by
                {shown.ownerList.map((o, i) => (
                  <span key={o.username}><Link href={`/u/${o.username}`} className="font-semibold text-ink hover:underline">@{o.username}</Link>{i < shown.ownerList.length - 1 ? "," : ""}</span>
                ))}
                {shown.owners > shown.ownerList.length && <span>and {shown.owners - shown.ownerList.length} more</span>}
              </p>
            )}
          </div>
        )}

        <div className="-ml-2.5 mt-2 flex items-center text-slate">
          <button onClick={like} aria-pressed={shown.liked} aria-label={shown.liked ? "Unlike" : "Like"} className={`tap inline-flex items-center gap-1.5 rounded-full px-2.5 hover:text-ink ${shown.liked ? "text-danger" : ""}`}>
            <Heart size={21} fill={shown.liked ? "currentColor" : "none"} aria-hidden /> <span className="tabular text-sm">{shown.like_count}</span>
          </button>
          <Link href={`/p/${shown.id}`} aria-label="Comments" className="tap inline-flex items-center gap-1.5 rounded-full px-2.5 hover:text-ink">
            <MessageCircle size={21} aria-hidden /> <span className="tabular text-sm">{shown.comment_count}</span>
          </Link>
          <button aria-label="Share to your followers" className="tap inline-flex items-center gap-1.5 rounded-full px-2.5 hover:text-ink disabled:opacity-40" disabled={mine}
            onClick={async () => { try { await api(`/api/posts/${shown.id}/repost`, { body: {} }); onChange?.(); } catch (e) { dialog.error(e); } }}>
            <Repeat2 size={21} aria-hidden /> <span className="tabular text-sm">{shown.repost_count}</span>
          </button>
          <span className="ml-auto" />
          {Number(shown.tip_total_usdc) > 0 && <span className="rounded-full bg-mint-soft px-3 py-1 text-xs font-bold text-mint-deep">$<Amount value={shown.tip_total_usdc} /> in tips</span>}
        </div>
      </div>
      {author?.username && <TipModal open={tipOpen} onClose={() => setTipOpen(false)} postId={shown.id} username={author.username} onTipped={onChange} />}
    </article>
  );
}

const REPORT_REASONS = ["Spam", "Scam or fraud", "Harassment", "Inappropriate", "Stolen content"];
