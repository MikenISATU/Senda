"use client";

import Link from "next/link";
import { useState } from "react";
import useSWR from "swr";
import { PageHeader } from "@/components/app/AppShell";
import { Amount, Avatar, Empty, Spinner, timeAgo } from "@/components/ui/bits";
import { STATUS_LABEL } from "@/lib/client/jobs";
import { useSession } from "@/lib/client/session";
import type { PublicProfile } from "@/lib/client/types";

type J = { id: string; title: string; role: string | null; budget: string; agreed_amount: string | null; asset: string; deadline: string; status: string; created_at: string; client: PublicProfile; freelancer: PublicProfile | null; client_id: string };

export default function JobsPage() {
  const { api, profile, config } = useSession();
  const [scope, setScope] = useState<"open" | "mine">("open");
  const { data } = useSWR(`/api/jobs?scope=${scope}`, (u: string) => api<J[]>(u));
  return (
    <div className="mx-auto w-full max-w-[920px]">
      <PageHeader title="Jobs"><Link href="/jobs/new" className="btn-primary">Post a job</Link></PageHeader>
      {!config?.escrowConfigured && <p className="px-4 pb-2 text-sm text-warn md:px-6">Escrow contract not configured yet: jobs can be posted, but funding is disabled until the contract ID is set.</p>}
      <div role="tablist" className="flex gap-1 px-4 md:px-6">
        {(["open", "mine"] as const).map((t) => <button key={t} role="tab" aria-selected={scope === t} onClick={() => setScope(t)} className={`tap rounded-full px-4 text-sm font-semibold ${scope === t ? "bg-ink text-white" : "text-slate hover:bg-white"}`}>{t === "open" ? "Open jobs" : "My jobs"}</button>)}
      </div>
      {!data ? <div className="p-6"><Spinner /></div> : data.length === 0 ? (
        <Empty title={scope === "open" ? "No open jobs right now" : "You have no jobs yet"} action={<Link href="/jobs/new" className="btn-primary">Post a job</Link>}>Clients post work, pick a freelancer, and lock payment in an on-chain escrow before work starts.</Empty>
      ) : (
        <ul className="mt-3">
          {data.map((j) => (
            <li key={j.id}>
              <Link href={`/jobs/${j.id}`} className="block border-b border-line px-4 py-4 hover:bg-white md:px-6">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="font-display text-lg font-semibold">{j.title}</p>
                    <p className="mt-0.5 flex items-center gap-2 text-sm text-slate"><Avatar src={j.client.avatar_url} name={j.client.username} size={20} /> @{j.client.username}{j.role ? `, ${j.role}` : ""}, posted {timeAgo(j.created_at)} ago</p>
                  </div>
                  <p className="shrink-0 text-right font-display text-lg font-semibold"><Amount value={j.agreed_amount ?? j.budget} asset={j.asset} /></p>
                </div>
                <p className="mt-2 text-sm"><span className={`rounded-full px-2.5 py-1 font-semibold ${j.status === "DISPUTED" ? "bg-danger-soft text-danger" : ["PAID", "RESOLVED"].includes(j.status) ? "bg-mint-soft text-mint-deep" : "bg-cobalt-soft text-ink"}`}>{STATUS_LABEL[j.status]}</span>{scope === "mine" && <span className="ml-2 text-slate">{j.client_id === profile?.id ? "You're the client" : "You're the freelancer"}</span>}</p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
