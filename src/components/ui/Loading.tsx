import { Logo } from "@/components/Logo";

/** Full-screen loader with the Senda mark. Used while the app or a page starts up. */
export function Splash({ label = "Loading" }: { label?: string }) {
  return (
    <main role="status" aria-live="polite" className="grid min-h-dvh place-items-center px-6">
      <div className="flex flex-col items-center gap-5">
        <div className="relative grid size-24 place-items-center">
          <svg className="splash-ring absolute inset-0" viewBox="0 0 96 96" aria-hidden>
            <defs>
              <linearGradient id="splash-g" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stopColor="#4169F5" /><stop offset="1" stopColor="#24CBA8" />
              </linearGradient>
            </defs>
            <circle cx="48" cy="48" r="44" fill="none" stroke="currentColor" strokeOpacity="0.12" strokeWidth="4" />
            <circle cx="48" cy="48" r="44" fill="none" stroke="url(#splash-g)" strokeWidth="4" strokeLinecap="round" strokeDasharray="90 190" />
          </svg>
          <span className="splash-mark"><Logo size={52} /></span>
        </div>
        <p className="font-display text-lg font-semibold">{label}</p>
      </div>
    </main>
  );
}

/** One grey placeholder block. Size it with Tailwind classes. */
export function Skeleton({ className = "" }: { className?: string }) {
  return <span aria-hidden className={`skeleton ${className}`} />;
}

/** Placeholder shaped like a post in the feed. */
export function PostSkeleton({ media = false }: { media?: boolean }) {
  return (
    <div aria-hidden className="sheet mb-4 overflow-hidden rounded-3xl p-5">
      <div className="flex items-center gap-3">
        <Skeleton className="size-12 shrink-0 rounded-full" />
        <div className="flex-1 space-y-2"><Skeleton className="h-4 w-36" /><Skeleton className="h-3 w-24" /></div>
        <Skeleton className="h-10 w-20 rounded-full" />
      </div>
      {media && <Skeleton className="mt-4 h-52 w-full rounded-2xl" />}
      <div className="mt-4 space-y-2"><Skeleton className="h-4 w-full" /><Skeleton className="h-4 w-2/3" /></div>
      <div className="mt-4 flex gap-4"><Skeleton className="h-5 w-12" /><Skeleton className="h-5 w-12" /><Skeleton className="h-5 w-12" /></div>
    </div>
  );
}

/** Placeholder for the feed: a few posts. */
export function FeedSkeleton({ label = "Loading posts" }: { label?: string }) {
  return (
    <div role="status">
      <span className="sr-only">{label}</span>
      <PostSkeleton media /><PostSkeleton /><PostSkeleton />
    </div>
  );
}

/** Placeholder for any list of rows: chats, activity, notifications, jobs. */
export function ListSkeleton({ rows = 5, label = "Loading" }: { rows?: number; label?: string }) {
  return (
    <div role="status" className="sheet divide-y divide-line overflow-hidden rounded-3xl">
      <span className="sr-only">{label}</span>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} aria-hidden className="flex items-center gap-3 px-4 py-3.5">
          <Skeleton className="size-10 shrink-0 rounded-full" />
          <div className="flex-1 space-y-2"><Skeleton className={`h-4 ${i % 2 ? "w-40" : "w-52"} max-w-full`} /><Skeleton className="h-3 w-28" /></div>
          <Skeleton className="h-4 w-14" />
        </div>
      ))}
    </div>
  );
}

/** Placeholder for a detail page: a title and a few cards. */
export function PageSkeleton({ label = "Loading" }: { label?: string }) {
  return (
    <div role="status" className="mx-auto w-full max-w-[920px] px-4 py-6 md:px-6">
      <span className="sr-only">{label}</span>
      <div aria-hidden className="space-y-4">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-4 w-72 max-w-full" />
        <Skeleton className="h-40 w-full rounded-3xl" />
        <Skeleton className="h-28 w-full rounded-3xl" />
        <Skeleton className="h-28 w-full rounded-3xl" />
      </div>
    </div>
  );
}
