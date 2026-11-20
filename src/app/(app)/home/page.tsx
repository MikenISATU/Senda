"use client";

import Link from "next/link";
import { useState } from "react";
import { Composer } from "@/components/app/Composer";
import { Empty, Feed } from "@/components/app/Feed";
import { PeopleRow } from "@/components/app/PeopleRow";

export default function HomePage() {
  const [tab, setTab] = useState<"following" | "explore">("following");
  return (
    <div className="mx-auto w-full max-w-[720px]">
      <h1 className="sr-only">Home</h1>
      <PeopleRow />
      <div role="tablist" aria-label="Feed" className="mx-4 mb-4 grid grid-cols-2 rounded-2xl bg-white p-1 ring-1 ring-line md:mx-6">
        {(["following", "explore"] as const).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}
            className={`tap rounded-xl text-sm font-semibold transition-colors ${tab === t ? "bg-cloud text-ink ring-1 ring-line" : "text-slate hover:text-ink"}`}>
            {t === "following" ? "Following" : "For you"}
          </button>
        ))}
      </div>
      <Feed
        key={tab}
        query={`feed=${tab}`}
        prepend={(refresh) => <Composer onPosted={refresh} />}
        empty={<Empty title="Nothing here yet" action={<Link href="/explore" className="btn-primary">Find people</Link>}>Follow a few people and their posts show up here.</Empty>}
      />
    </div>
  );
}
