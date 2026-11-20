"use client";

import { useState } from "react";
import { PageHeader } from "@/components/app/AppShell";
import { Empty, Feed } from "@/components/app/Feed";
import { PeopleSearch } from "@/components/app/PeopleSearch";

export default function ExplorePage() {
  const [tab, setTab] = useState<"explore" | "premium" | "owned">("explore");
  return (
    <div className="mx-auto w-full max-w-[780px]">
      <PageHeader title="Explore" />
      <div className="px-4 md:px-6">
        <PeopleSearch variant="page" />
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
