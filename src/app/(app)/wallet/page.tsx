"use client";

import { ArrowDownLeft, ArrowUpRight, Copy, ExternalLink } from "lucide-react";
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
type H = { items: { id: string; txHash: string; createdAt: string; direction: "in" | "out"; asset: string; amount: string; counterparty: string | null; counterpartyUsername: string | null; explorerUrl: string; type: string }[]; next: string | null };

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
  const [tab, setTab] = useState<"send" | "receive">("send");
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [asset, setAsset] = useState<"XLM" | "USDC">("USDC");
  const [memo, setMemo] = useState("");
  const [copied, setCopied] = useState(false);
  const refresh = () => { w.mutate(); h.mutate(); };
  useEffect(() => {
    const sync = () => { if (location.hash === "#receive") setTab("receive"); };
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
          {(["send", "receive"] as const).map((t) => (
            <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={`tap rounded-full px-5 text-sm font-semibold ${tab === t ? "bg-cloud text-ink ring-1 ring-line" : "text-slate hover:text-ink"}`}>{t === "send" ? "Send" : "Receive"}</button>
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
                    <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-full ${i.direction === "in" ? "bg-mint-soft text-mint-deep" : "bg-cobalt-soft text-cobalt-deep"}`}>
                      {i.direction === "in" ? <ArrowDownLeft size={18} aria-hidden /> : <ArrowUpRight size={18} aria-hidden />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold">{i.direction === "in" ? "From " : "To "}{i.counterpartyUsername ? `@${i.counterpartyUsername}` : shortAddr(i.counterparty)}</span>
                      <span className="text-sm text-slate">{i.type === "create_account" ? "Account activation" : "Payment"}, {timeAgo(i.createdAt)} ago</span>
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
