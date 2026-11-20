"use client";

import { PageSkeleton } from "@/components/ui/Loading";
import Link from "next/link";
import useSWR from "swr";
import { PageHeader } from "@/components/app/AppShell";
import { Amount, Empty, Notice, timeAgo } from "@/components/ui/bits";
import { useSession } from "@/lib/client/session";
import type { PreparedIntent } from "@/lib/client/types";
import { useTx } from "@/lib/client/useTx";

type O = {
  reports: { id: string; entity_type: string; entity_id: string; reason: string; created_at: string; reporter: { username: string } }[];
  disputes: { id: string; title: string; asset: string; agreed_amount: string; updated_at: string }[];
  faucetToday: Record<string, number>; faucetCap: number;
  workflowRuns: { workflow_key: string; provider: string; status: string; tx_hash: string | null; created_at: string }[];
  treasury: { xlm: string; usdc: string | null } | null;
  fees: { contractId: string; explorer: string; config: { sendBps: number; platformBps: number; paused: boolean; shares: { to: string; bps: number }[] }; tokens: { code: "XLM" | "USDC"; collected: string; waiting: string }[] } | null;
};

export default function AdminPage() {
  const { api, profile } = useSession();
  const { run } = useTx();
  const o = useSWR("/api/admin/overview", (u: string) => api<O>(u));
  if (o.error) return <div className="p-6"><Notice tone="danger">{(o.error as Error).message}</Notice></div>;
  if (!o.data) return <PageSkeleton />;
  const d = o.data;
  return (
    <div className="mx-auto max-w-4xl space-y-4 px-4 pb-10 md:px-6">
      <PageHeader flush title="Admin" />

      <section className="sheet p-5" aria-labelledby="disp-h">
        <h2 id="disp-h" className="text-lg font-semibold">Open disputes</h2>
        {d.disputes.length === 0 ? <p className="mt-2 text-slate">None.</p> : (
          <ul className="mt-2 divide-y divide-line">{d.disputes.map((j) => <li key={j.id} className="flex justify-between py-2"><Link className="link" href={`/jobs/${j.id}`}>{j.title}</Link><Amount value={j.agreed_amount} asset={j.asset} /></li>)}</ul>
        )}
        <p className="mt-2 text-sm text-slate">Resolving requires the wallet configured as the contract's mediator; the contract rejects anyone else.</p>
      </section>

      {profile?.role === "admin" && (
        <section className="sheet p-5" aria-labelledby="rep-h">
          <h2 id="rep-h" className="text-lg font-semibold">Reports</h2>
          {d.reports.length === 0 ? <Empty title="No open reports" /> : (
            <ul className="mt-2 divide-y divide-line">
              {d.reports.map((r) => (
                <li key={r.id} className="py-3">
                  <p className="text-sm"><b>{r.entity_type}</b> {r.entity_type === "post" ? <Link className="link" href={`/p/${r.entity_id}`}>open</Link> : r.entity_id} reported by @{r.reporter.username}, {timeAgo(r.created_at)} ago</p>
                  <p className="mt-1">{r.reason}</p>
                  <div className="mt-2 flex gap-2">
                    {["dismiss", "hide", ...(r.entity_type === "profile" ? ["ban"] : [])].map((a) => (
                      <button key={a} className={a === "dismiss" ? "btn-outline" : "btn-danger"} onClick={async () => { await api(`/api/admin/reports/${r.id}`, { body: { action: a } }); o.mutate(); }}>{a === "dismiss" ? "Dismiss" : a === "hide" ? "Hide content" : "Ban user"}</button>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <section className="grid gap-4 sm:grid-cols-2">
        <div className="sheet p-5">
          <h2 className="text-lg font-semibold">Faucet today</h2>
          <p className="mt-1 tabular">XLM {d.faucetToday.XLM ?? 0}, USDC {d.faucetToday.USDC ?? 0} (cap {d.faucetCap} each)</p>
          <p className="mt-2 text-sm text-slate">Treasury: {d.treasury ? <><Amount value={d.treasury.xlm} asset="XLM" />, <Amount value={d.treasury.usdc ?? "0"} asset="USDC" /></> : "TREASURY_PUBLIC_ADDRESS not set"}</p>
        </div>
        <div className="sheet p-5">
          <h2 className="text-lg font-semibold">Fees</h2>
          {!d.fees ? <p className="mt-1 text-sm text-slate">Fee contract not set. Payments go through with no Senda fee.</p> : (
            <>
              <p className="mt-1 text-sm text-slate">Send {d.fees.config.sendBps / 100}%, tips and sales {d.fees.config.platformBps / 100}%{d.fees.config.paused ? " (paused)" : ""}</p>
              <ul className="mt-2 text-sm">
                {d.fees.config.shares.map((s) => <li key={s.to} className="flex justify-between gap-3"><span className="tabular">{s.to.slice(0, 6)}...{s.to.slice(-6)}</span><span>{s.bps / 100}%</span></li>)}
              </ul>
              <a className="link mt-2 inline-block text-sm" href={d.fees.explorer} target="_blank" rel="noreferrer">View contract</a>
            </>
          )}
        </div>
      </section>

      {d.fees && profile?.role === "admin" && (
        <section className="sheet p-5" aria-labelledby="fee-h">
          <h2 id="fee-h" className="text-lg font-semibold">Fees paid out</h2>
          <p className="mt-1 text-sm text-slate">Send, tip and sale fees are paid out instantly. Job fees wait in the contract until they are distributed (automatic on the hourly check, or press the button).</p>
          <ul className="mt-3 divide-y divide-line">
            {d.fees.tokens.map((t) => (
              <li key={t.code} className="flex flex-wrap items-center justify-between gap-3 py-2">
                <span>Paid out so far: <Amount value={t.collected} asset={t.code} /></span>
                <span className="flex items-center gap-3">
                  <span className="text-sm text-slate">Waiting: <Amount value={t.waiting} asset={t.code} /></span>
                  <button className="btn-outline" disabled={Number(t.waiting) <= 0} onClick={() => run(() => api<PreparedIntent>("/api/admin/fees", { body: { asset: t.code } }), { onConfirmed: () => o.mutate() })}>Distribute</button>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="sheet p-5">
        <h2 className="text-lg font-semibold">Recent payments</h2>
        <ul className="mt-2 divide-y divide-line text-sm">
          {d.workflowRuns.map((r, i) => <li key={i} className="flex justify-between py-2"><span>{r.workflow_key} via {r.provider}</span><span>{r.status}, {timeAgo(r.created_at)} ago</span></li>)}
        </ul>
      </section>
    </div>
  );
}
