"use client";

import { Search, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import useSWR from "swr";
import { Avatar } from "@/components/ui/bits";
import { useSession } from "@/lib/client/session";

type U = { id: string; username: string; display_name: string | null; avatar_url: string | null; bio?: string | null; follower_count?: number; following?: boolean };

/** Waits a moment after typing stops so we search once, not on every key. */
function useDebounced(value: string, ms: number) {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}

/**
 * Find a person. Type a name or username and results list underneath as you
 * type. Enter opens the first result, arrow keys move, "/" jumps to the box.
 * `variant="header"` floats the list over the page; `variant="page"` shows it inline.
 */
export function PeopleSearch({ variant = "header", autoFocus = false, onNavigate }: { variant?: "header" | "page"; autoFocus?: boolean; onNavigate?: () => void }) {
  const { api, profile } = useSession();
  const router = useRouter();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(variant === "page");
  const [active, setActive] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();
  const term = useDebounced(q.trim(), 140);
  const searching = term.length >= 1;
  const found = useSWR(searching ? `/api/users/search?q=${encodeURIComponent(term)}` : null, (u: string) => api<U[]>(u), { keepPreviousData: true, dedupingInterval: 30_000 });
  // Before typing: people you follow and a few suggestions (already loaded for Home).
  const people = useSWR("/api/follows", (u: string) => api<U[]>(u), { revalidateOnFocus: false });
  const items = (searching ? found.data ?? [] : (people.data ?? []).slice(0, 6)).filter((u) => u.id !== profile?.id);
  const loading = searching && (q.trim() !== term || (found.isLoading && !found.data));
  const show = variant === "page" ? true : open;

  useEffect(() => setActive(0), [term]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.key === "/" && !e.metaKey && !e.ctrlKey && !(t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable))) {
        e.preventDefault(); input.current?.focus();
      }
    };
    const onDoc = (e: MouseEvent) => { if (variant === "header" && !box.current?.contains(e.target as Node)) setOpen(false); };
    window.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDoc);
    return () => { window.removeEventListener("keydown", onKey); document.removeEventListener("mousedown", onDoc); };
  }, [variant]);

  function go(u: U) { setOpen(variant === "page"); setQ(""); onNavigate?.(); router.push(`/u/${u.username}`); }

  const list = (
    <div id={listId} className={variant === "header"
      ? "absolute inset-x-0 top-full z-40 mt-2 max-h-[70dvh] overflow-auto rounded-3xl bg-white p-2 shadow-2xl ring-1 ring-line"
      : "mt-3 rounded-3xl bg-white p-2 ring-1 ring-line"}>
      <p className="px-3 pb-1 pt-2 text-xs font-bold uppercase tracking-wider text-slate">{searching ? (loading && !items.length ? "Searching" : "People") : "Suggested"}</p>
      {items.length > 0 ? (
        <ul role="listbox" aria-label="People">
          {items.map((u, i) => (
            <li key={u.id} role="option" aria-selected={i === active}>
              <Link href={`/u/${u.username}`} onClick={() => { setOpen(variant === "page"); setQ(""); onNavigate?.(); }} onMouseEnter={() => setActive(i)}
                className={`flex items-center gap-3 rounded-2xl px-3 py-2.5 ${i === active ? "bg-cloud" : ""}`}>
                <Avatar src={u.avatar_url} name={u.username} size={42} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold leading-tight">{u.display_name ?? u.username}</span>
                  <span className="block truncate text-sm text-slate">@{u.username}{u.bio ? ` · ${u.bio}` : ""}</span>
                </span>
                {typeof u.follower_count === "number" && u.follower_count > 0 && <span className="shrink-0 text-xs text-slate">{u.follower_count} {u.follower_count === 1 ? "follower" : "followers"}</span>}
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="px-3 py-3 text-sm text-slate">{searching ? (loading ? "Looking..." : `No one found for "${term}". Try a username or a name.`) : "Type a name or username."}</p>
      )}
    </div>
  );

  return (
    <div ref={box} className="relative w-full">
      <label className="sr-only" htmlFor={`${listId}-in`}>Search people</label>
      <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate"><Search size={18} aria-hidden /></span>
      <input
        ref={input} id={`${listId}-in`} type="text" inputMode="search" enterKeyHint="search" autoComplete="off" autoCapitalize="none" spellCheck={false} autoFocus={autoFocus}
        className="field h-12 rounded-2xl" style={{ paddingLeft: "2.75rem", paddingRight: "2.75rem" }} placeholder="Search people"
        role="combobox" aria-expanded={show} aria-controls={listId} aria-autocomplete="list"
        value={q}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, items.length - 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
          else if (e.key === "Enter" && items[active]) { e.preventDefault(); go(items[active]); }
          else if (e.key === "Escape") { setOpen(variant === "page"); (e.target as HTMLInputElement).blur(); onNavigate?.(); }
        }}
      />
      {q && <button type="button" aria-label="Clear search" onClick={() => { setQ(""); input.current?.focus(); }} className="absolute right-2 top-1/2 grid size-8 -translate-y-1/2 place-items-center rounded-full text-slate hover:text-ink"><X size={16} /></button>}
      {show && list}
    </div>
  );
}
