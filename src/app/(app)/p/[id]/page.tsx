"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import useSWR from "swr";
import { PostCard } from "@/components/app/PostCard";
import { Avatar, Notice, Spinner, timeAgo } from "@/components/ui/bits";
import { useSession } from "@/lib/client/session";
import type { Post, PublicProfile } from "@/lib/client/types";

type C = { id: string; body: string; created_at: string; author: PublicProfile };

export default function PostPage() {
  const { id } = useParams<{ id: string }>();
  const { api } = useSession();
  const post = useSWR(`/api/posts/${id}`, (u: string) => api<Post>(u));
  const comments = useSWR(`/api/posts/${id}/comments`, (u: string) => api<C[]>(u));
  const [body, setBody] = useState("");
  const [err, setErr] = useState<string | null>(null);
  if (post.error) return <div className="p-6"><Notice tone="danger">{(post.error as Error).message}</Notice></div>;
  if (!post.data) return <div className="p-6"><Spinner /></div>;
  return (
    <div className="mx-auto w-full max-w-[780px]">
      <PostCard key={JSON.stringify([post.data.unlocked, post.data.like_count])} post={post.data} onChange={() => post.mutate()} />
      <form className="flex gap-2 border-b border-line px-4 py-3 md:px-6" onSubmit={async (e) => {
        e.preventDefault(); setErr(null);
        try { await api(`/api/posts/${id}/comments`, { body: { body } }); setBody(""); comments.mutate(); post.mutate(); } catch (x) { setErr((x as Error).message); }
      }}>
        <label htmlFor="c" className="sr-only">Write a comment</label>
        <input id="c" className="field" value={body} onChange={(e) => setBody(e.target.value)} placeholder="Write a comment" maxLength={1000} />
        <button className="btn-primary" disabled={!body.trim()}>Reply</button>
      </form>
      {err && <div className="px-4 py-2"><Notice tone="danger">{err}</Notice></div>}
      <ul>
        {comments.data?.map((c) => (
          <li key={c.id} className="flex gap-3 border-b border-line px-4 py-3 md:px-6">
            <Avatar src={c.author.avatar_url} name={c.author.username} size={32} />
            <div><p className="text-sm"><Link href={`/u/${c.author.username}`} className="font-semibold hover:underline">@{c.author.username}</Link> <span className="text-slate">{timeAgo(c.created_at)}</span></p><p className="whitespace-pre-wrap break-words">{c.body}</p></div>
          </li>
        ))}
      </ul>
    </div>
  );
}
