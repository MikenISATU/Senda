"use client";

import { useEffect, useId, useRef, useState } from "react";
import useSWR from "swr";
import { Avatar } from "@/components/ui/bits";
import { useSession } from "@/lib/client/session";

type U = { id: string; username: string; display_name: string | null; avatar_url: string | null };

/**
 * "To" field with username search. Typing a name (with or without @) shows
 * matching Senda users to pick from; a pasted G... address is accepted as is.
 */
export function RecipientInput({ id, value, onChange }: { id: string; value: string; onChange: (v: string) => void }) {
  const { api, profile } = useSession();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const listId = useId();
  const q = value.trim().replace(/^@/, "").toLowerCase();
  const isAddress = /^G[A-Z2-7]{55}$/.test(value.trim());
  const canSearch = q.length >= 1 && /^[a-z0-9_]{1,20}$/.test(q) && !isAddress;
  const { data } = useSWR(canSearch ? `/api/users/search?q=${encodeURIComponent(q)}` : null, (u: string) => api<U[]>(u), { keepPreviousData: true });
  const items = (data ?? []).filter((u) => u.id !== profile?.id);
  const exact = items.length === 1 && items[0].username === q;
  const show = open && canSearch && items.length > 0 && !exact;

  useEffect(() => setActive(0), [q]);
  useEffect(() => {
    const onDoc = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  function pick(u: U) { onChange(`@${u.username}`); setOpen(false); }

  return (
    <div ref={box} className="relative">
      <input
        id={id}
        className="field"
        placeholder="@username or address"
        value={value}
        onChange={(e) => { onChange(e.target.value.trim()); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (!show) return;
          if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, items.length - 1)); }
          if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
          if (e.key === "Enter") { e.preventDefault(); pick(items[active]); }
          if (e.key === "Escape") setOpen(false);
        }}
        required
        autoComplete="off"
        role="combobox"
        aria-expanded={show}
        aria-controls={listId}
        aria-autocomplete="list"
      />
      {show && (
        <ul id={listId} role="listbox" className="absolute inset-x-0 top-full z-20 mt-1 max-h-72 overflow-auto rounded-2xl bg-white p-1 shadow-[0_16px_40px_-16px_rgba(16,27,45,0.35)] ring-1 ring-line">
          {items.map((u, i) => (
            <li key={u.id} role="option" aria-selected={i === active}>
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => pick(u)} onMouseEnter={() => setActive(i)}
                className={`flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left ${i === active ? "bg-cloud" : ""}`}>
                <Avatar src={u.avatar_url} name={u.username} size={32} />
                <span className="min-w-0">
                  <span className="block truncate font-semibold">{u.display_name ?? u.username}</span>
                  <span className="block truncate text-sm text-slate">@{u.username}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {canSearch && data && items.length === 0 && open && (
        <p className="hint">No user named @{q}. You can still paste a wallet address.</p>
      )}
    </div>
  );
}
