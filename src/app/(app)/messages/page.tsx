"use client";

import Link from "next/link";
import useSWR from "swr";
import { PageHeader } from "@/components/app/AppShell";
import { Avatar, Empty, Spinner, timeAgo } from "@/components/ui/bits";
import { useSession } from "@/lib/client/session";
import type { PublicProfile } from "@/lib/client/types";

type C = { id: string; kind: string; jobs: { title: string } | null; others: PublicProfile[]; lastMessage: { body: string; created_at: string } | null; unread: boolean; last_message_at: string };

export default function Messages() {
  const { api } = useSession();
  const { data } = useSWR("/api/conversations", (u: string) => api<C[]>(u), { refreshInterval: 15_000 });
  return (
    <div className="mx-auto w-full max-w-[780px]">
      <PageHeader title="Messages" />
      {!data ? <div className="p-6"><Spinner /></div> : data.length === 0 ? (
        <Empty title="No conversations yet" action={<Link href="/explore" className="btn-primary">Find someone to message</Link>}>Open a profile and tap the message button. Every hired job also gets its own chat.</Empty>
      ) : (
        <ul>
          {data.map((c) => {
            const other = c.others[0];
            return (
              <li key={c.id}>
                <Link href={`/messages/${c.id}`} className="flex items-center gap-3 border-b border-line px-4 py-3 hover:bg-white md:px-6">
                  <Avatar src={other?.avatar_url} name={other?.username} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline gap-2"><b className="truncate">{c.jobs ? c.jobs.title : `@${other?.username}`}</b>{c.unread && <span className="h-2 w-2 rounded-full bg-cobalt" aria-label="Unread" />}</span>
                    <span className="block truncate text-sm text-slate">{c.jobs ? `Job chat with @${other?.username}: ` : ""}{c.lastMessage?.body ?? "No messages yet"}</span>
                  </span>
                  <span className="text-sm text-slate">{timeAgo(c.last_message_at)}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
