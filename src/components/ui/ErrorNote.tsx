"use client";

import { AlertTriangle, ChevronDown, Copy, RefreshCw, WifiOff } from "lucide-react";
import { useEffect, useState } from "react";
import { friendlyError, type Friendly } from "@/lib/client/errors";

/**
 * A problem, said plainly: what happened, what to do, one clear button.
 * The technical text sits behind "Details" with a code people can quote.
 * Built for a phone: full-width button, large tap targets, text that wraps.
 */
export function ErrorNote({ error, onRetry, compact = false }: { error: unknown | Friendly; onRetry?: () => void; compact?: boolean }) {
  const fr: Friendly = error && typeof error === "object" && "code" in error && "detail" in error && "title" in error ? (error as Friendly) : friendlyError(error);
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const Icon = fr.code.startsWith("NET") ? WifiOff : AlertTriangle;
  const calm = fr.code === "WALLET-CANCELLED";
  const button =
    fr.action === "signin" ? { label: "Sign in", run: () => { location.href = `/login?next=${encodeURIComponent(location.pathname)}`; } }
    : fr.action === "reload" ? { label: "Reload Senda", run: () => location.reload() }
    : fr.action === "retry" && onRetry ? { label: "Try again", run: onRetry }
    : null;
  const report = `Senda error ${fr.code}\n${fr.title}\n${fr.detail}\n${typeof location === "undefined" ? "" : location.pathname} at ${new Date().toISOString()}`;

  return (
    <div role="alert" className={`rounded-2xl ${calm ? "bg-cloud ring-1 ring-line" : "bg-danger-soft"} ${compact ? "p-3.5" : "p-4"}`}>
      <div className="flex gap-3">
        <span className={`grid size-9 shrink-0 place-items-center rounded-full ${calm ? "bg-white text-slate" : "bg-white/60 text-danger"}`}><Icon size={18} aria-hidden /></span>
        <div className="min-w-0 flex-1">
          <p className={`font-semibold ${calm ? "text-ink" : "text-danger"}`}>{fr.title}</p>
          <p className="mt-0.5 break-words text-sm text-ink">{fr.message}</p>
          {fr.safe && !calm && <p className="mt-1 text-sm text-slate">No money was moved.</p>}
        </div>
      </div>
      {button && (
        <button type="button" onClick={button.run} className="btn-ink mt-3 w-full sm:w-auto"><RefreshCw size={16} aria-hidden /> {button.label}</button>
      )}
      {!calm && (
        <div className="mt-2">
          <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="tap inline-flex items-center gap-1 text-sm text-slate hover:text-ink">
            Details <ChevronDown size={14} aria-hidden className={open ? "rotate-180 transition-transform" : "transition-transform"} />
          </button>
          {open && (
            <div className="mt-1 rounded-xl bg-white/70 p-3 text-xs text-slate">
              <p>Code <b className="tabular text-ink">{fr.code}</b></p>
              <p className="mt-1 max-h-28 overflow-auto break-words">{fr.detail}</p>
              <button type="button" className="tap mt-1 inline-flex items-center gap-1 font-semibold text-ink"
                onClick={() => { navigator.clipboard?.writeText(report).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }).catch(() => {}); }}>
                <Copy size={13} aria-hidden /> {copied ? "Copied" : "Copy for support"}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Slim bar that appears when the phone or computer goes offline, and goes away when it's back. */
export function OfflineBar() {
  const [offline, setOffline] = useState(false);
  useEffect(() => {
    const sync = () => setOffline(!navigator.onLine);
    sync();
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => { window.removeEventListener("online", sync); window.removeEventListener("offline", sync); };
  }, []);
  if (!offline) return null;
  return (
    <div role="status" className="sticky top-0 z-30 flex items-center justify-center gap-2 bg-warn-soft px-4 py-2 text-center text-sm font-semibold text-warn">
      <WifiOff size={16} aria-hidden /> You're offline. Payments and posts will work again when you're back online.
    </div>
  );
}

/** Whole-screen version, used when a page itself fails to load. */
export function ErrorScreen({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <main className="mx-auto grid min-h-[70dvh] w-full max-w-md place-items-center px-4 py-10">
      <div className="w-full"><ErrorNote error={error} onRetry={onRetry ?? (() => location.reload())} /></div>
    </main>
  );
}
