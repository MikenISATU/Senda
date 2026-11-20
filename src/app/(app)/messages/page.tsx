"use client";

import Link from "next/link";
import useSWR from "swr";
import { PeopleRow } from "@/components/app/PeopleRow";
import { Avatar, Empty, Spinner, timeAgo } from "@/components/ui/bits";
import { useSession } from "@/lib/client/session";
import type { PublicProfile } from "@/lib/client/types";

type C = { id: string; kind: string; jobs: { title: string } | null; others: PublicProfile[]; lastMessage: { body: string; created_at: string } | null; unread: boolean; last_message_at: string };

export default function Messages() {
  const { api } = useSession();
  const { data } = useSWR("/api/conversations", (u: string) => api<C[]>(u), { refreshInterval: 15_000 });
  return (
    <div className="mx-auto w-full max-w-[720px]">
      <h1 className="px-4 pb-3 pt-2 text-3xl font-semibold tracking-tight md:px-6">Chats</h1>
      <PeopleRow />
      {!data ? <div className="p-6"><Spinner /></div> : data.length === 0 ? (
        <Empty title="No chats yet" action={<Link href="/explore" className="btn-primary">Find someone</Link>}>Open a profile and tap Message.</Empty>
      ) : (
        <ul className="mx-4 overflow-hidden rounded-[1.75rem] bg-white ring-1 ring-line md:mx-6">
          {data.map((c) => {
            const other = c.others[0];
            return (
              <li key={c.id} className="border-b border-line last:border-0">
                <Link href={`/messages/${c.id}`} className="flex items-center gap-3 px-4 py-3.5 hover:bg-cloud/60">
                  <span className={c.unread ? "ring-grad shrink-0" : "ring-quiet shrink-0"}><span className="block rounded-full bg-white p-0.5"><Avatar src={other?.avatar_url} name={other?.username} size={44} /></span></span>
                  <span className="min-w-0 flex-1">
                    <b className="block truncate">{c.jobs ? c.jobs.title : other?.display_name ?? `@${other?.username}`}</b>
                    <span className={`block truncate text-sm ${c.unread ? "text-ink" : "text-slate"}`}>{c.jobs ? `Job with @${other?.username}: ` : ""}{c.lastMessage?.body ?? "Say hi"}</span>
                  </span>
                  <span className="flex flex-col items-end gap-1.5">
                    <span className="text-xs text-slate">{timeAgo(c.last_message_at)}</span>
                    {c.unread && <span className="grad size-2.5 rounded-full" aria-label="Unread" />}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
