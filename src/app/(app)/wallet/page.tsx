"use client";

import { ArrowDownLeft, ArrowDownUp, ArrowUpRight, Copy, ExternalLink, Repeat } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { useEffect, useState } from "react";
import useSWR from "swr";
import useSWRInfinite from "swr/infinite";
import { PageHeader } from "@/components/app/AppShell";
import { FaucetPanel } from "@/components/app/FaucetPanel";
import { RecipientInput } from "@/components/app/RecipientInput";
import { Amount, Empty, Notice, shortAddr, timeAgo } from "@/components/ui/bits";
import { ListSkeleton, Skeleton } from "@/components/ui/Loading";
import { useSession } from "@/lib/client/session";
import type { PreparedIntent } from "@/lib/client/types";
import { useTx } from "@/lib/client/useTx";

type W = { address: string; balances: { exists: boolean; xlm: string; usdc: string | null; xlmAvailable: string }; network: string; explorer: string };
type H = { items: { id: string; txHash: string; createdAt: string; direction: "in" | "out"; asset: string; amount: string; counterparty: string | null; counterpartyUsername: string | null; explorerUrl: string; type: string; paid?: string }[]; next: string | null };

/** How many activity rows show at first, and how many each "Show more" adds. */
const ACTIVITY_FIRST = 5;
const ACTIVITY_STEP = 10;

export default function WalletPage() {
  const { api, config } = useSession();
  const { run } = useTx();
  const w = useSWR("/api/wallet", (u: string) => api<W>(u), { refreshInterval: 30_000 });
  // Activity loads a page at a time and shows a few rows, so a busy wallet never becomes a very long page.
  const h = useSWRInfinite<H>(
    (i, prev: H | null) => (i === 0 ? "/api/wallet/history" : prev?.next ? `/api/wallet/history?cursor=${encodeURIComponent(prev.next)}` : null),
    (u: string) => api<H>(u),
    { refreshInterval: 30_000, revalidateFirstPage: true },
  );
  const [shown, setShown] = useState(ACTIVITY_FIRST);
  const activity = h.data?.flatMap((p) => p.items) ?? [];
  const moreOnServer = !!h.data?.[h.data.length - 1]?.next;
  const canShowMore = shown < activity.length || moreOnServer;
  function showMore() {
    const next = shown + ACTIVITY_STEP;
    if (next > activity.length && moreOnServer) h.setSize(h.size + 1);
    setShown(next);
  }
  const [tab, setTab] = useState<"send" | "receive" | "swap">("send");
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [asset, setAsset] = useState<"XLM" | "USDC">("USDC");
  const [memo, setMemo] = useState("");
  const [copied, setCopied] = useState(false);
  const refresh = () => { w.mutate(); h.mutate(); };
  useEffect(() => {
    const sync = () => { if (location.hash === "#receive") setTab("receive"); if (location.hash === "#swap") setTab("swap"); };
    sync();
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);
  const b = w.data?.balances;

  return (
    <div className="mx-auto w-full max-w-[920px] px-4 md:px-6">
      <PageHeader flush title="Wallet" />
      {w.error && <Notice tone="danger">{(w.error as Error).message}</Notice>}
      <section aria-label="Balances" className="hero-card relative overflow-hidden rounded-[1.75rem] p-6 md:p-8">
        <div aria-hidden className="pointer-events-none absolute -right-16 -top-20 size-64 rounded-full bg-snow/10 blur-3xl" />
        <div className="relative">
        {!b ? <div role="status" className="grid gap-5 sm:grid-cols-2"><span className="sr-only">Loading your balance</span><div className="space-y-2"><Skeleton className="h-4 w-28 opacity-40" /><Skeleton className="h-10 w-40 opacity-40" /></div><div className="space-y-2"><Skeleton className="h-4 w-16 opacity-40" /><Skeleton className="h-10 w-40 opacity-40" /></div></div> : (
          <>
            <div className="grid gap-5 sm:grid-cols-2">
              <div>
                <p className="text-sm text-snow/70">Dollars (USDC)</p>
                <p className="font-display text-4xl font-semibold"><Amount value={b.usdc ?? "0"} decimals={2} /></p>
                {b.usdc === null && <p className="text-sm text-snow/70">Not turned on yet</p>}
              </div>
              <div>
                <p className="text-sm text-snow/70">XLM</p>
                <p className="font-display text-4xl font-semibold"><Amount value={b.xlm} decimals={2} /></p>
                <p className="text-sm text-snow/70"><Amount value={b.xlmAvailable} decimals={2} /> available</p>
              </div>
            </div>
            <p className="mt-5 text-sm">
              <a href={w.data?.explorer} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-snow/80 hover:text-snow hover:underline">See the public record <ExternalLink size={13} aria-hidden /></a>
            </p>
          </>
        )}
        </div>
      </section>

      <section id="receive" className="sheet mt-4 scroll-mt-24 rounded-3xl p-5 md:p-6" aria-label="Send or receive">
        <div role="tablist" className="mb-4 flex gap-1">
          {(["send", "receive", "swap"] as const).map((t) => (
            <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={`tap rounded-full px-5 text-sm font-semibold ${tab === t ? "bg-cloud text-ink ring-1 ring-line" : "text-slate hover:text-ink"}`}>{t === "send" ? "Send" : t === "receive" ? "Receive" : "Swap"}</button>
          ))}
        </div>
        {tab === "send" ? (
          <form className="space-y-3" onSubmit={(e) => {
            e.preventDefault();
            run(() => api<PreparedIntent>("/api/payments/prepare", { body: { to, amount, asset, memo: memo || undefined, idempotencyKey: crypto.randomUUID() } }), { onConfirmed: () => { setAmount(""); setMemo(""); refresh(); } });
          }}>
            <div><label className="label" htmlFor="to">To</label><RecipientInput id="to" value={to} onChange={setTo} /></div>
            <div className="grid grid-cols-[1fr_auto] gap-2">
              <div><label className="label" htmlFor="amt">Amount</label><input id="amt" className="field tabular" inputMode="decimal" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} required /></div>
              <div><label className="label" htmlFor="as">Currency</label><select id="as" className="field" value={asset} onChange={(e) => setAsset(e.target.value as "XLM" | "USDC")}><option>USDC</option><option>XLM</option></select></div>
            </div>
            <div><label className="label" htmlFor="memo">Note (optional)</label><input id="memo" className="field" maxLength={28} value={memo} onChange={(e) => setMemo(e.target.value)} /></div>
            <button className="btn-primary w-full sm:w-auto" disabled={!to || !amount}>Continue</button>
            {!!config?.sendFeeBps && <p className="hint">{(config.sendFeeBps / 100).toFixed(2).replace(/\.?0+$/, "")}% fee, shown before you confirm.</p>}
          </form>
        ) : tab === "swap" ? (
          <SwapForm usdcOn={b ? b.usdc !== null : true} xlm={b?.xlmAvailable ?? "0"} usdc={b?.usdc ?? "0"} onDone={refresh} />
        ) : w.data ? (
          <div className="flex flex-col items-center gap-3 text-center sm:flex-row sm:items-start sm:text-left">
            <div className="rounded-xl bg-snow p-3"><QRCodeSVG value={`web+stellar:pay?destination=${w.data.address}`} size={168} level="M" title="Your wallet QR code" /></div>
            <div className="min-w-0">
              <p className="text-sm text-slate">Your wallet address</p>
              <p className="tabular break-all font-semibold">{w.data.address}</p>
              <button className="btn-outline mt-3" onClick={() => { navigator.clipboard.writeText(w.data!.address); setCopied(true); setTimeout(() => setCopied(false), 1500); }}><Copy size={16} aria-hidden /> {copied ? "Copied" : "Copy address"}</button>
              <p className="mt-3 text-sm text-slate">Friends on Senda can just pay your username.</p>
            </div>
          </div>
        ) : null}
      </section>

      {config?.faucetEnabled && (
        <section id="faucet" className="sheet mt-4 scroll-mt-24 rounded-3xl p-5 md:p-6" aria-labelledby="faucet-h">
          <h2 id="faucet-h" className="mb-3 text-lg font-semibold">Free test money</h2>
          <FaucetPanel onChange={refresh} />
        </section>
      )}

      <section className="mt-6" aria-labelledby="hist-h">
        <div className="mb-2 flex items-baseline justify-between gap-3">
          <h2 id="hist-h" className="text-lg font-semibold">Activity</h2>
          {activity.length > 0 && <p className="text-sm text-slate">Showing {Math.min(shown, activity.length)} of {activity.length}{moreOnServer ? "+" : ""}</p>}
        </div>
        {!h.data ? <ListSkeleton rows={ACTIVITY_FIRST} label="Loading activity" /> : activity.length === 0 ? <Empty title="Nothing yet">Money you send or receive shows up here.</Empty> : (
          <>
            <ul className="sheet divide-y divide-line overflow-hidden rounded-3xl">
              {activity.slice(0, shown).map((i) => (
                <li key={i.id}>
                  <a href={i.explorerUrl} target="_blank" rel="noreferrer" className="flex items-center gap-3 px-4 py-3 hover:bg-cloud">
                    <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-full ${i.type === "swap" ? "bg-cloud text-ink ring-1 ring-line" : i.direction === "in" ? "bg-mint-soft text-mint-deep" : "bg-cobalt-soft text-cobalt-deep"}`}>
                      {i.type === "swap" ? <Repeat size={17} aria-hidden /> : i.direction === "in" ? <ArrowDownLeft size={18} aria-hidden /> : <ArrowUpRight size={18} aria-hidden />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold">{i.type === "swap" ? `Swapped ${i.paid ?? ""}` : `${i.direction === "in" ? "From " : "To "}${i.counterpartyUsername ? `@${i.counterpartyUsername}` : shortAddr(i.counterparty)}`}</span>
                      <span className="text-sm text-slate">{i.type === "swap" ? "Swap" : i.type === "create_account" ? "Account activation" : "Payment"}, {timeAgo(i.createdAt)} ago</span>
                    </span>
                    <span className={`tabular shrink-0 font-semibold ${i.direction === "in" ? "text-mint-deep" : ""}`}>{i.direction === "in" ? "+" : "-"}<Amount value={i.amount} asset={i.asset} decimals={7} /></span>
                  </a>
                </li>
              ))}
            </ul>
            {(canShowMore || shown > ACTIVITY_FIRST) && (
              <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
                {canShowMore && <button className="btn-outline" onClick={showMore} disabled={h.isValidating && shown >= activity.length}>{h.isValidating && shown >= activity.length ? "Loading" : "Show more"}</button>}
                {shown > ACTIVITY_FIRST && <button className="btn-ghost" onClick={() => { setShown(ACTIVITY_FIRST); document.getElementById("hist-h")?.scrollIntoView({ block: "nearest" }); }}>Show less</button>}
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}

type Quote = { from: "XLM" | "USDC"; to: "XLM" | "USDC"; send: string; receive: string; minReceive: string; rate: string; slippagePercent: number };

/** Swap between XLM and USDC inside your own wallet, at the live price. */
function SwapForm({ usdcOn, xlm, usdc, onDone }: { usdcOn: boolean; xlm: string; usdc: string; onDone: () => void }) {
  const { api } = useSession();
  const { run } = useTx();
  const [from, setFrom] = useState<"XLM" | "USDC">("XLM");
  const [amount, setAmount] = useState("");
  const [typed, setTyped] = useState("");
  const to = from === "XLM" ? "USDC" : "XLM";
  const have = from === "XLM" ? xlm : usdc;
  // Ask for a price shortly after typing stops, and refresh it while the form is open.
  useEffect(() => { const t = setTimeout(() => setTyped(amount), 350); return () => clearTimeout(t); }, [amount]);
  const valid = Number(typed) > 0;
  const q = useSWR(valid ? `/api/swap/quote?from=${from}&amount=${encodeURIComponent(typed)}` : null, (u: string) => api<Quote>(u), { refreshInterval: 15_000, keepPreviousData: false, shouldRetryOnError: false });
  const waiting = valid && (amount !== typed || q.isLoading);
  const needsUsdc = to === "USDC" && !usdcOn;

  return (
    <form className="space-y-3" onSubmit={(e) => {
      e.preventDefault();
      run(() => api<PreparedIntent>("/api/swap/prepare", { body: { from, amount, idempotencyKey: crypto.randomUUID() } }), { onConfirmed: () => { setAmount(""); onDone(); } });
    }}>
      <div className="rounded-2xl bg-cloud p-4 ring-1 ring-line">
        <div className="flex items-center justify-between gap-3">
          <label className="text-sm font-semibold text-slate" htmlFor="swap-amt">You pay</label>
          <button type="button" className="tap text-sm text-slate hover:text-ink" onClick={() => setAmount(String(Math.max(0, Math.floor((Number(have) - (from === "XLM" ? 0.5 : 0)) * 100) / 100)))}>
            You have <Amount value={have} decimals={2} /> {from}
          </button>
        </div>
        <div className="mt-1 flex items-center gap-3">
          <input id="swap-amt" className="tabular min-w-0 flex-1 bg-transparent font-display text-3xl font-semibold outline-none placeholder:text-slate/50" inputMode="decimal" placeholder="0" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} />
          <span className="rounded-full bg-white px-4 py-2 text-sm font-bold ring-1 ring-line">{from}</span>
        </div>
      </div>

      <div className="relative z-10 -my-5 flex justify-center">
        <button type="button" aria-label={`Switch to swapping ${to} for ${from}`} onClick={() => { setFrom(to); setAmount(""); }} className="grad grid size-11 place-items-center rounded-full ring-4 ring-white transition-transform hover:rotate-180">
          <ArrowDownUp size={18} aria-hidden />
        </button>
      </div>

      <div className="rounded-2xl bg-cloud p-4 ring-1 ring-line" aria-live="polite">
        <p className="text-sm font-semibold text-slate">You get about</p>
        <div className="mt-1 flex items-center gap-3">
          <p className="tabular min-w-0 flex-1 truncate font-display text-3xl font-semibold">
            {waiting ? <Skeleton className="inline-block h-8 w-32 align-middle" /> : q.data && valid ? <Amount value={q.data.receive} decimals={4} /> : <span className="text-slate/50">0</span>}
          </p>
          <span className="rounded-full bg-white px-4 py-2 text-sm font-bold ring-1 ring-line">{to}</span>
        </div>
      </div>

      {q.data && valid && !waiting && (
        <dl className="space-y-1 px-1 text-sm text-slate">
          <div className="flex justify-between gap-3"><dt>Price</dt><dd className="tabular text-ink">1 {q.data.from} = {q.data.rate} {q.data.to}</dd></div>
          <div className="flex justify-between gap-3"><dt>You get at least</dt><dd className="tabular text-ink"><Amount value={q.data.minReceive} decimals={4} /> {q.data.to}</dd></div>
          <div className="flex justify-between gap-3"><dt>Senda fee</dt><dd className="text-ink">None</dd></div>
        </dl>
      )}
      {q.error && valid && !waiting && <Notice tone="warn">{(q.error as Error).message}</Notice>}
      {needsUsdc && (
        <Notice tone="info">
          Turn on USDC first so your wallet can hold it.{" "}
          <button type="button" className="font-semibold underline" onClick={() => run(() => api<PreparedIntent>("/api/trustline/prepare", { body: {} }), { onConfirmed: onDone })}>Turn on USDC</button>
        </Notice>
      )}
      <button className="btn-primary w-full" disabled={!valid || waiting || !q.data || needsUsdc}>Review swap</button>
      <p className="hint">Swaps use Stellar's built-in exchange at the live price. You see the exact amounts before you confirm.</p>
    </form>
  );
}
