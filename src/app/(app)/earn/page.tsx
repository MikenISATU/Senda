"use client";

import { useState } from "react";
import useSWR from "swr";
import { PageHeader } from "@/components/app/AppShell";
import { Amount, Notice, Spinner } from "@/components/ui/bits";
import { useSession } from "@/lib/client/session";
import type { PreparedIntent } from "@/lib/client/types";
import { useTx } from "@/lib/client/useTx";

type E = {
  config: { enabled: boolean; experimental: boolean; reason: string | null; poolId: string | null; assetIsCircleUsdc: boolean; targetAprDisplay: number; mode: "vault" | "direct" };
  reserve: { utilization: number; totalSupplied: string; enabled: boolean } | null;
  position: { value: string; netDeposited: string } | null;
  measured: { apy: number; windowDays: number; since: string } | null;
  error?: string;
};

export default function EarnPage() {
  const { api } = useSession();
  const { run } = useTx();
  const { data, mutate } = useSWR("/api/earn", (u: string) => api<E>(u));
  const [principal, setPrincipal] = useState("1000");
  const [days, setDays] = useState("365");
  const [amount, setAmount] = useState("");
  const [action, setAction] = useState<"supply" | "withdraw">("supply");
  const [accepted, setAccepted] = useState(false);
  const [max, setMax] = useState(false);
  const apr = data?.config.targetAprDisplay ?? 0.05;
  const p = Number(principal) || 0;
  const d = Number(days) || 0;
  const example = (p * apr * d) / 365;

  return (
    <div className="mx-auto w-full max-w-[920px] px-4 md:px-6">
      <PageHeader flush title="USDC Earn" />
      <p className="max-w-prose text-slate">
        Holding USDC in your wallet earns nothing. Earn is optional: your USDC is lent to an audited Stellar lending pool (Blend), and borrowers pay variable interest.
        {data?.config.mode === "vault" ? " Deposits go through the Senda Earn vault contract, which holds pool shares for everyone and lets only you withdraw yours." : " You lend straight from your own wallet; Senda never holds these funds."}
      </p>

      {!data ? <div className="mt-6"><Spinner /></div> : (
        <>
          <div className="mt-5 space-y-3">
            {!data.config.enabled && <Notice tone="info">{data.config.reason}</Notice>}
            {data.config.enabled && data.config.mode === "vault" && <Notice tone="warn">The Senda Earn vault contract has not been independently audited. It runs on testnet only and can have bugs that lose funds.</Notice>}
            {data.config.enabled && data.config.experimental && <Notice tone="warn">Testnet experiment. The pool, its rates and its tokens are test versions{data.config.assetIsCircleUsdc ? "" : "; this pool uses its own test USDC, not the faucet's Circle test USDC"}. Nothing here predicts mainnet results.</Notice>}
            {data.error && <Notice tone="danger">{data.error}</Notice>}
          </div>

          <section className="mt-5 grid gap-4 sm:grid-cols-2" aria-label="Rates">
            <div className="sheet p-5">
              <p className="text-sm text-slate">Measured supply APY</p>
              {data.measured ? (
                <>
                  <p className="font-display text-4xl font-semibold tabular">{(data.measured.apy * 100).toFixed(2)}%</p>
                  <p className="text-sm text-slate">Realized over the last {data.measured.windowDays.toFixed(1)} days from on-chain pool data. It changes constantly and can drop to zero.</p>
                </>
              ) : (
                <>
                  <p className="font-display text-4xl font-semibold">Measuring</p>
                  <p className="text-sm text-slate">Needs at least 24 hours of on-chain pool history before showing a real number.</p>
                </>
              )}
              {data.reserve && <p className="mt-2 text-sm text-slate">Pool utilization {(data.reserve.utilization * 100).toFixed(1)}%, total supplied <Amount value={data.reserve.totalSupplied} /></p>}
            </div>
            <div className="sheet p-5">
              <p className="text-sm text-slate">Your position</p>
              <p className="font-display text-4xl font-semibold"><Amount value={data.position?.value ?? "0"} decimals={2} /></p>
              <p className="text-sm text-slate">Deposited (net): <Amount value={data.position?.netDeposited ?? "0"} decimals={2} /></p>
            </div>
          </section>

          <section className="sheet mt-4 p-5" aria-labelledby="ex-h">
            <h2 id="ex-h" className="text-lg font-semibold">What would {(apr * 100).toFixed(0)}% look like?</h2>
            <p className="text-sm text-slate">An illustration, not a promise or forecast. {(apr * 100).toFixed(0)}% simple APR is a target used for examples only; the real rate is whatever the pool pays.</p>
            <div className="mt-3 grid grid-cols-2 gap-3 sm:max-w-sm">
              <div><label className="label" htmlFor="pr">USDC</label><input id="pr" className="field tabular" inputMode="decimal" value={principal} onChange={(e) => setPrincipal(e.target.value)} /></div>
              <div><label className="label" htmlFor="dy">Days</label><input id="dy" className="field tabular" inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value)} /></div>
            </div>
            <p className="mt-3"><Amount value={p.toFixed(2)} asset="USDC" /> for {d} days at {(apr * 100).toFixed(0)}% simple = <b><Amount value={example.toFixed(2)} asset="USDC" /></b> before costs and losses, only if that rate held the whole time.</p>
          </section>

          {data.config.enabled && (
            <section className="sheet mt-4 p-5" aria-labelledby="mv-h">
              <h2 id="mv-h" className="text-lg font-semibold">Move funds</h2>
              <form className="mt-3 space-y-3" onSubmit={(e) => { e.preventDefault(); run(() => api<PreparedIntent>("/api/earn", { body: { action, amount: max && action === "withdraw" ? "0" : amount, max: max && action === "withdraw", acceptRisks: true } }), { onConfirmed: () => { setAmount(""); setMax(false); mutate(); } }); }}>
                <div role="radiogroup" aria-label="Direction" className="flex gap-1">
                  {(["supply", "withdraw"] as const).map((a) => (
                    <button type="button" key={a} role="radio" aria-checked={action === a} onClick={() => setAction(a)} className={`tap rounded-full px-4 text-sm font-semibold ${action === a ? "bg-ink text-white" : "text-slate hover:bg-cloud"}`}>{a === "supply" ? "Deposit" : "Withdraw"}</button>
                  ))}
                </div>
                <div className="sm:max-w-xs"><label className="label" htmlFor="ea">Amount</label><input id="ea" className="field tabular" inputMode="decimal" value={max && action === "withdraw" ? "" : amount} placeholder={max && action === "withdraw" ? "Everything" : ""} disabled={max && action === "withdraw"} onChange={(e) => setAmount(e.target.value)} required={!(max && action === "withdraw")} /></div>
                {action === "withdraw" && <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4" checked={max} onChange={(e) => setMax(e.target.checked)} /> Withdraw everything</label>}
                <details className="text-sm">
                  <summary className="cursor-pointer font-semibold">Risks you accept</summary>
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-slate">
                    <li>Interest is variable and can be zero.</li>
                    <li>Bad debt in the pool can reduce what you get back.</li>
                    <li>If most of the pool is borrowed, withdrawals can be delayed until borrowers repay.</li>
                    <li>Smart contracts can have bugs even after audits.</li>
                  </ul>
                </details>
                <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1 h-4 w-4" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} /> I understand there is no guaranteed return and I can lose money.</label>
                <button className="btn-primary" disabled={!accepted || (!amount && !(max && action === "withdraw"))}>{action === "supply" ? "Review deposit" : "Review withdrawal"}</button>
              </form>
            </section>
          )}
        </>
      )}
    </div>
  );
}
