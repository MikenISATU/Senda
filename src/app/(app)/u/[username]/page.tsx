"use client";

import { Copy, MessageCircle } from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import useSWR from "swr";
import { Empty, Feed } from "@/components/app/Feed";
import { TipModal } from "@/components/app/TipModal";
import { Avatar, Notice, shortAddr, Spinner } from "@/components/ui/bits";
import { useSession } from "@/lib/client/session";
import type { PublicProfile } from "@/lib/client/types";

type R = { profile: PublicProfile; wallet: string | null; following: boolean; isSelf: boolean };

export default function ProfilePage() {
  const { username } = useParams<{ username: string }>();
  const { api } = useSession();
  const router = useRouter();
  const { data, error, mutate } = useSWR(`/api/users/${username}`, (u: string) => api<R>(u));
  const [tip, setTip] = useState(false);
  if (error) return <div className="p-6"><Notice tone="danger">{(error as Error).message}</Notice></div>;
  if (!data) return <div className="p-6"><Spinner /></div>;
  const p = data.profile;
  return (
    <div className="mx-auto w-full max-w-[780px]">
      <section className="border-b border-line px-4 pb-5 pt-6 md:px-6">
        <div className="flex items-start justify-between gap-4">
          <Avatar src={p.avatar_url} name={p.username} size={72} />
          {!data.isSelf && (
            <div className="flex flex-wrap justify-end gap-2">
              <button className="btn-outline px-3" aria-label="Message" onClick={async () => { const c = await api<{ id: string }>("/api/conversations", { body: { username: p.username } }); router.push(`/messages/${c.id}`); }}><MessageCircle size={18} /></button>
              <button className="btn-outline" onClick={() => setTip(true)}>Tip</button>
              <button className={data.following ? "btn-outline" : "btn-ink"} onClick={async () => { await api("/api/follows", { body: { username: p.username, follow: !data.following } }); mutate(); }}>
                {data.following ? "Following" : "Follow"}
              </button>
            </div>
          )}
        </div>
        <h1 className="mt-3 text-2xl font-semibold">{p.display_name ?? p.username}</h1>
        <p className="text-slate">@{p.username}</p>
        {p.bio && <p className="mt-2 max-w-prose whitespace-pre-wrap">{p.bio}</p>}
        <p className="mt-3 flex gap-4 text-sm"><span><b className="tabular">{p.following_count}</b> <span className="text-slate">following</span></span><span><b className="tabular">{p.follower_count}</b> <span className="text-slate">followers</span></span></p>
        {data.wallet && (
          <button className="mt-2 inline-flex items-center gap-1.5 text-sm text-slate hover:text-ink" onClick={() => navigator.clipboard.writeText(data.wallet!)}>
            <span className="tabular">{shortAddr(data.wallet)}</span> <Copy size={13} aria-hidden /><span className="sr-only">Copy address</span>
          </button>
        )}
      </section>
      <Feed query={`author=${p.id}`} empty={<Empty title="No posts yet" />} />
      {tip && p.username && <TipModal open={tip} onClose={() => setTip(false)} username={p.username} />}
    </div>
  );
}
