"use client";

import useSWRInfinite from "swr/infinite";
import { Empty, Notice, Spinner } from "@/components/ui/bits";
import { useSession } from "@/lib/client/session";
import type { Post } from "@/lib/client/types";
import { PostCard } from "./PostCard";

type Page = { items: Post[]; next: string | null };

export function Feed({ query, empty, prepend }: { query: string; empty: React.ReactNode; prepend?: (refresh: () => void) => React.ReactNode }) {
  const { api } = useSession();
  const { data, error, size, setSize, mutate, isValidating } = useSWRInfinite<Page>(
    (i, prev: Page | null) => (i === 0 ? `/api/posts?${query}` : prev?.next ? `/api/posts?${query}&before=${encodeURIComponent(prev.next)}` : null),
    (u: string) => api<Page>(u),
  );
  const items = data?.flatMap((p) => p.items) ?? [];
  const more = data?.[data.length - 1]?.next;
  return (
    <>
      {prepend?.(() => mutate())}
      {error && <div className="p-4"><Notice tone="danger">{(error as Error).message}</Notice></div>}
      {!data && !error && <div className="p-6"><Spinner label="Loading posts" /></div>}
      {data && items.length === 0 && empty}
      <div aria-live="polite">
        {items.map((p) => <PostCard key={p.id} post={p} onChange={() => mutate()} onRemoved={() => mutate()} />)}
      </div>
      {more && (
        <div className="p-4 text-center">
          <button className="btn-outline" onClick={() => setSize(size + 1)} disabled={isValidating}>{isValidating ? "Loading" : "Show older posts"}</button>
        </div>
      )}
      {data && !more && items.length > 0 && <p className="py-8 text-center text-sm text-slate">You're all caught up.</p>}
    </>
  );
}

export { Empty };
