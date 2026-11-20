"use client";

import { Plus } from "lucide-react";
import Link from "next/link";
import useSWR from "swr";
import { Avatar } from "@/components/ui/bits";
import { useSession } from "@/lib/client/session";

type Person = { id: string; username: string; display_name: string | null; avatar_url: string | null; following: boolean };

/** Row of faces at the top of Home and Chats: you first, then people you follow, then a few new faces. */
export function PeopleRow() {
  const { api, profile } = useSession();
  const { data } = useSWR("/api/follows", (u: string) => api<Person[]>(u));
  return (
    <ul aria-label="People" className="no-scrollbar flex gap-4 overflow-x-auto px-4 pb-4 pt-1 md:px-6">
      <li className="shrink-0">
        <a href="/home#compose" className="flex w-[68px] flex-col items-center gap-1.5">
          <span className="ring-grad relative">
            <span className="block rounded-full bg-cloud p-[3px]"><Avatar src={profile?.avatar_url} name={profile?.username} size={56} /></span>
            <span className="grad absolute -bottom-0.5 -right-0.5 grid size-6 place-items-center rounded-full ring-2 ring-cloud"><Plus size={14} strokeWidth={3} aria-hidden /></span>
          </span>
          <span className="w-full truncate text-center text-xs text-slate">You</span>
        </a>
      </li>
      {(data ?? []).map((p) => (
        <li key={p.id} className="shrink-0">
          <Link href={`/u/${p.username}`} className="flex w-[68px] flex-col items-center gap-1.5">
            <span className={p.following ? "ring-grad" : "ring-quiet"}>
              <span className="block rounded-full bg-cloud p-[3px]"><Avatar src={p.avatar_url} name={p.username} size={56} /></span>
            </span>
            <span className="w-full truncate text-center text-xs text-slate">{p.display_name ?? p.username}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
