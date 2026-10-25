"use client";

import Link from "next/link";
import { useEffect } from "react";
import useSWR from "swr";
import { PageHeader } from "@/components/app/AppShell";
import { Avatar, Empty, Spinner, timeAgo } from "@/components/ui/bits";
import { useSession } from "@/lib/client/session";
import type { PublicProfile } from "@/lib/client/types";

type N = { id: string; type: string; body: string; entity_type: string | null; entity_id: string | null; read_at: string | null; created_at: string; actor: PublicProfile | null };

function hrefFor(n: N) {
  if (n.entity_type === "post") return `/p/${n.entity_id}`;
  if (n.entity_type === "job") return `/jobs/${n.entity_id}`;
  if (n.entity_type === "conversation") return `/messages/${n.entity_id}`;
  if (n.entity_type === "tx") return "/wallet";
  if (n.actor?.username) return `/u/${n.actor.username}`;
  return "/home";
}

export default function NotificationsPage() {
  const { api } = useSession();
  const { data } = useSWR("/api/notifications", (u: string) => api<N[]>(u), { refreshInterval: 20_000 });
  useEffect(() => { if (data?.some((n) => !n.read_at)) api("/api/notifications", { body: {} }).catch(() => null); }, [data, api]);
  return (
    <div className="mx-auto w-full max-w-[780px]">
      <PageHeader title="Notifications" />
      {!data ? <div className="p-6"><Spinner /></div> : data.length === 0 ? <Empty title="No notifications yet">Likes, tips, payments, messages and job updates show up here.</Empty> : (
        <ul>
          {data.map((n) => (
            <li key={n.id}>
              <Link href={hrefFor(n)} className={`flex items-center gap-3 border-b border-line px-4 py-3 hover:bg-white md:px-6 ${n.read_at ? "" : "bg-cobalt-soft/50"}`}>
                <Avatar src={n.actor?.avatar_url} name={n.actor?.username ?? "S"} size={36} />
                <p className="min-w-0 flex-1">{n.actor ? <b>@{n.actor.username} </b> : null}{n.body}</p>
                <span className="text-sm text-slate">{timeAgo(n.created_at)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
