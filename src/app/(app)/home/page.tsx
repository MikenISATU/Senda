"use client";

import Link from "next/link";
import { useState } from "react";
import { PageHeader } from "@/components/app/AppShell";
import { Composer } from "@/components/app/Composer";
import { Empty, Feed } from "@/components/app/Feed";

export default function HomePage() {
  const [tab, setTab] = useState<"following" | "explore">("following");
  return (
    <div className="mx-auto w-full max-w-[780px]">
      <PageHeader title="Home" />
      <div role="tablist" aria-label="Feed" className="mx-4 mb-4 inline-flex rounded-2xl bg-white p-1 ring-1 ring-line md:mx-6">
        {(["following", "explore"] as const).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}
            className={`tap rounded-xl px-5 text-sm font-semibold transition-colors ${tab === t ? "bg-ink text-white" : "text-slate hover:text-ink"}`}>
            {t === "following" ? "Following" : "Everyone"}
          </button>
        ))}
      </div>
      <Feed
        key={tab}
        query={`feed=${tab}`}
        prepend={(refresh) => <Composer onPosted={refresh} />}
        empty={<Empty title="Your feed is quiet" action={<Link href="/explore" className="btn-primary">Find people to follow</Link>}>Follow creators to see their posts here, or post something yourself.</Empty>}
      />
    </div>
  );
}
