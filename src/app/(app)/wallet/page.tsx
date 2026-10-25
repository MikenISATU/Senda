"use client";

import { ArrowDownLeft, ArrowUpRight, Copy, ExternalLink } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { useEffect, useState } from "react";
import useSWR from "swr";
import { PageHeader } from "@/components/app/AppShell";
import { FaucetPanel } from "@/components/app/FaucetPanel";
import { RecipientInput } from "@/components/app/RecipientInput";
import { Amount, Empty, Notice, shortAddr, Spinner, timeAgo } from "@/components/ui/bits";
import { useSession } from "@/lib/client/session";
import type { PreparedIntent } from "@/lib/client/types";
import { useTx } from "@/lib/client/useTx";

type W = { address: string; balances: { exists: boolean; xlm: string; usdc: string | null; xlmAvailable: string }; network: string; explorer: string };
type H = { items: { id: string; txHash: string; createdAt: string; direction: "in" | "out"; asset: string; amount: string; counterparty: string | null; counterpartyUsername: string | null; explorerUrl: string; type: string }[]; next: string | null };

export default function WalletPage() {
  const { api, config } = useSession();
  const { run } = useTx();
  const w = useSWR("/api/wallet", (u: string) => api<W>(u), { refreshInterval: 30_000 });
  const h = useSWR("/api/wallet/history", (u: string) => api<H>(u), { refreshInterval: 30_000 });
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
      <section aria-label="Balances" className="relative overflow-hidden rounded-3xl bg-ink p-6 text-white md:p-8">
        <div aria-hidden className="pointer-events-none absolute -right-16 -top-20 size-64 rounded-full bg-cobalt/35 blur-3xl" />
        <div aria-hidden className="pointer-events-none absolute -bottom-24 left-10 size-56 rounded-full bg-mint/25 blur-3xl" />
        <div className="relative">
        {!b ? <Spinner label="Reading balances from Stellar" /> : (
          <>
            <div className="grid gap-5 sm:grid-cols-2">
              <div>
                <p className="text-sm text-white/70">USDC</p>
                <p className="font-display text-4xl font-semibold"><Amount value={b.usdc ?? "0"} decimals={2} /></p>
                {b.usdc === null && <p className="text-sm text-white/70">Not enabled yet</p>}
              </div>
              <div>
                <p className="text-sm text-white/70">XLM</p>
                <p className="font-display text-4xl font-semibold"><Amount value={b.xlm} decimals={2} /></p>
                <p className="text-sm text-white/70"><Amount value={b.xlmAvailable} decimals={2} /> spendable after reserve</p>
              </div>
            </div>
            <p className="mt-5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-white/70">
              Live from Stellar {w.data?.network}
              <a href={w.data?.explorer} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-mint hover:underline">Open in explorer <ExternalLink size={13} aria-hidden /></a>
            </p>
          </>
        )}
        </div>
      </section>

      <section id="receive" className="sheet mt-4 scroll-mt-24 rounded-3xl p-5 md:p-6" aria-label="Send or receive">
        <div role="tablist" className="mb-4 flex gap-1">
          {(["send", "receive"] as const).map((t) => (
            <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={`tap rounded-full px-4 text-sm font-semibold ${tab === t ? "bg-ink text-white" : "text-slate hover:bg-cloud"}`}>{t === "send" ? "Send" : "Receive"}</button>
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
              <div><label className="label" htmlFor="as">Asset</label><select id="as" className="field" value={asset} onChange={(e) => setAsset(e.target.value as "XLM" | "USDC")}><option>USDC</option><option>XLM</option></select></div>
            </div>
            <div><label className="label" htmlFor="memo">Note (optional, public on-chain)</label><input id="memo" className="field" maxLength={28} value={memo} onChange={(e) => setMemo(e.target.value)} /></div>
            <button className="btn-primary w-full sm:w-auto" disabled={!to || !amount}>Review payment</button>
          </form>
        ) : w.data ? (
          <div className="flex flex-col items-center gap-3 text-center sm:flex-row sm:items-start sm:text-left">
            <div className="rounded-xl bg-white p-3 ring-1 ring-line"><QRCodeSVG value={`web+stellar:pay?destination=${w.data.address}`} size={168} level="M" title="Your Stellar address QR code" /></div>
            <div className="min-w-0">
              <p className="text-sm text-slate">Your Stellar address</p>
              <p className="tabular break-all font-semibold">{w.data.address}</p>
              <button className="btn-outline mt-3" onClick={() => { navigator.clipboard.writeText(w.data!.address); setCopied(true); setTimeout(() => setCopied(false), 1500); }}><Copy size={16} aria-hidden /> {copied ? "Copied" : "Copy address"}</button>
              <p className="mt-3 text-sm text-slate">Senda users can also pay you by username. To receive USDC, enable USDC first. Only send Stellar {config?.network} assets to this address.</p>
            </div>
          </div>
        ) : null}
      </section>

      {config?.faucetEnabled && (
        <section id="faucet" className="sheet mt-4 scroll-mt-24 rounded-3xl p-5 md:p-6" aria-labelledby="faucet-h">
          <h2 id="faucet-h" className="mb-3 text-lg font-semibold">Test funds</h2>
          <FaucetPanel onChange={refresh} />
        </section>
      )}

      <section className="mt-6" aria-labelledby="hist-h">
        <h2 id="hist-h" className="mb-2 text-lg font-semibold">Activity</h2>
        {!h.data ? <Spinner /> : h.data.items.length === 0 ? <Empty title="No transactions yet">Payments you send or receive appear here once they're on the ledger.</Empty> : (
          <ul className="sheet divide-y divide-line overflow-hidden rounded-3xl">
            {h.data.items.map((i) => (
              <li key={i.id}>
                <a href={i.explorerUrl} target="_blank" rel="noreferrer" className="flex items-center gap-3 px-4 py-3 hover:bg-cloud">
                  <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-full ${i.direction === "in" ? "bg-mint-soft text-mint-deep" : "bg-cobalt-soft text-cobalt-deep"}`}>
                    {i.direction === "in" ? <ArrowDownLeft size={18} aria-hidden /> : <ArrowUpRight size={18} aria-hidden />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{i.direction === "in" ? "From " : "To "}{i.counterpartyUsername ? `@${i.counterpartyUsername}` : shortAddr(i.counterparty)}</span>
                    <span className="text-sm text-slate">{i.type === "create_account" ? "Account activation" : "Payment"}, {timeAgo(i.createdAt)} ago</span>
                  </span>
                  <span className={`tabular font-semibold ${i.direction === "in" ? "text-mint-deep" : ""}`}>{i.direction === "in" ? "+" : "-"}<Amount value={i.amount} asset={i.asset} decimals={7} /></span>
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
