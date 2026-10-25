"use client";

import Link from "next/link";
import { useState } from "react";
import useSWR from "swr";
import { PageHeader } from "@/components/app/AppShell";
import { Empty, Feed } from "@/components/app/Feed";
import { Avatar } from "@/components/ui/bits";
import { useSession } from "@/lib/client/session";

type U = { id: string; username: string; display_name: string | null; avatar_url: string | null };

export default function ExplorePage() {
  const { api } = useSession();
  const [q, setQ] = useState("");
  const [tab, setTab] = useState<"explore" | "premium" | "owned">("explore");
  const { data: users } = useSWR(q.length >= 1 ? `/api/users/search?q=${encodeURIComponent(q)}` : null, (u: string) => api<U[]>(u));
  return (
    <div className="mx-auto w-full max-w-[780px]">
      <PageHeader title="Explore" />
      <div className="px-4 md:px-6">
        <label htmlFor="search" className="sr-only">Search people</label>
        <input id="search" type="search" className="field" placeholder="Search @username" value={q} onChange={(e) => setQ(e.target.value)} />
        {users && users.length > 0 && (
          <ul className="sheet mt-2 divide-y divide-line">
            {users.map((u) => (
              <li key={u.id}><Link href={`/u/${u.username}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-cloud"><Avatar src={u.avatar_url} name={u.username} size={32} /><span className="font-semibold">{u.display_name}</span><span className="text-slate">@{u.username}</span></Link></li>
            ))}
          </ul>
        )}
        <div role="tablist" className="mt-4 flex gap-1">
          {(["explore", "premium", "owned"] as const).map((t) => (
            <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={`tap rounded-full px-4 text-sm font-semibold ${tab === t ? "bg-ink text-white" : "text-slate hover:bg-white"}`}>
              {t === "explore" ? "Latest" : t === "premium" ? "Premium" : "Owned"}
            </button>
          ))}
        </div>
      </div>
      <Feed key={tab} query={`feed=${tab}`} empty={tab === "owned" ? <Empty title="No purchases yet">Premium posts you buy will appear here.</Empty> : <Empty title="Nothing here yet">Be the first to post.</Empty>} />
    </div>
  );
}
