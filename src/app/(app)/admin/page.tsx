"use client";

import Link from "next/link";
import { useState } from "react";
import useSWR from "swr";
import { PageHeader } from "@/components/app/AppShell";
import { Amount, Empty, Notice, Spinner, timeAgo } from "@/components/ui/bits";
import { useSession } from "@/lib/client/session";
import type { PreparedIntent } from "@/lib/client/types";
import { useTx } from "@/lib/client/useTx";

type O = {
  reports: { id: string; entity_type: string; entity_id: string; reason: string; created_at: string; reporter: { username: string } }[];
  disputes: { id: string; title: string; asset: string; agreed_amount: string; updated_at: string }[];
  faucetToday: Record<string, number>; faucetCap: number;
  workflowRuns: { workflow_key: string; provider: string; status: string; tx_hash: string | null; created_at: string }[];
  treasury: { xlm: string; usdc: string | null } | null; feeWallet: { xlm: string; usdc: string | null } | null; feeCollector: string | null; isFeeCollector: boolean;
};
type P = { apiConfigured: boolean; workflows: { key: string; configured: boolean; deploymentId?: string; triggerType?: string; execute?: string; network?: string; error?: string }[]; events: { event_id: string; tx_hash: string; topic: string; data: { verified?: boolean; workflow?: string }; created_at: string }[] };

export default function AdminPage() {
  const { api, profile } = useSession();
  const { run } = useTx();
  const o = useSWR("/api/admin/overview", (u: string) => api<O>(u));
  const pf = useSWR(profile?.role === "admin" ? "/api/admin/paiflow" : null, (u: string) => api<P>(u));
  const [sweep, setSweep] = useState({ workflow: "FEES_USDC", amount: "" });
  const [msg, setMsg] = useState<string | null>(null);
  if (o.error) return <div className="p-6"><Notice tone="danger">{(o.error as Error).message}</Notice></div>;
  if (!o.data) return <div className="p-6"><Spinner /></div>;
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
          <h2 className="text-lg font-semibold">Platform fees</h2>
          <p className="mt-1 text-sm text-slate">Fee wallet: {d.feeWallet ? <><Amount value={d.feeWallet.usdc ?? "0"} asset="USDC" />, <Amount value={d.feeWallet.xlm} asset="XLM" /></> : "FEE_COLLECTOR_ADDRESS not set"}</p>
        </div>
      </section>

      {pf.data && (
        <section className="sheet p-5" aria-labelledby="pf-h">
          <h2 id="pf-h" className="text-lg font-semibold">Paiflow workflows</h2>
          {!pf.data.apiConfigured && <div className="mt-2"><Notice tone="info">PAIFLOW_API_KEY is not set. Person-to-person payments, tips, purchases and escrow work without it; Paiflow is used for fixed-recipient fee routing.</Notice></div>}
          <table className="mt-3 w-full text-left text-sm">
            <thead><tr className="border-b border-line text-slate"><th className="py-2 font-semibold">Key</th><th className="font-semibold">Deployment</th><th className="font-semibold">Trigger</th><th className="font-semibold">Execute</th></tr></thead>
            <tbody>
              {pf.data.workflows.map((w) => (
                <tr key={w.key} className="border-b border-line align-top">
                  <td className="py-2 font-semibold">{w.key}</td>
                  <td className="tabular">{w.configured ? (w.deploymentId?.slice(0, 8) ?? "set") : "not set"}</td>
                  <td>{w.error ? <span className="text-danger">{w.error}</span> : w.triggerType ?? ""}</td>
                  <td>{w.execute ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <form className="mt-4 flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); setMsg(null); run(() => api<PreparedIntent>("/api/admin/paiflow", { body: { action: "sweep", ...sweep } }), { onConfirmed: () => { o.mutate(); pf.mutate(); } }); }}>
            <div><label className="label" htmlFor="wf">Sweep fees through</label><select id="wf" className="field" value={sweep.workflow} onChange={(e) => setSweep({ ...sweep, workflow: e.target.value })}><option value="FEES_USDC">USDC fees</option><option value="FEES_XLM">XLM fees</option></select></div>
            <div><label className="label" htmlFor="sa">Amount</label><input id="sa" className="field tabular w-32" inputMode="decimal" value={sweep.amount} onChange={(e) => setSweep({ ...sweep, amount: e.target.value })} /></div>
            <button className="btn-primary" disabled={!d.isFeeCollector || !sweep.amount}>Review sweep</button>
            <button type="button" className="btn-outline" onClick={async () => { const r = await api<Record<string, number>>("/api/admin/paiflow", { body: { action: "sync" } }); setMsg(`Synced: ${JSON.stringify(r)}`); pf.mutate(); }}>Sync events</button>
          </form>
          {!d.isFeeCollector && <p className="mt-2 text-sm text-slate">Sweeping needs you to be signed in with the fee-collector wallet.</p>}
          {msg && <p className="mt-2 text-sm">{msg}</p>}
          {pf.data.events.length > 0 && (
            <ul className="mt-4 divide-y divide-line text-sm">
              {pf.data.events.map((e) => <li key={e.event_id} className="flex justify-between gap-3 py-2"><span>{e.data.workflow} {e.topic}</span><span className={e.data.verified ? "text-mint-deep" : "text-warn"}>{e.data.verified ? "verified" : "unverified"}</span></li>)}
            </ul>
          )}
        </section>
      )}

      <section className="sheet p-5">
        <h2 className="text-lg font-semibold">Recent workflow runs</h2>
        <ul className="mt-2 divide-y divide-line text-sm">
          {d.workflowRuns.map((r, i) => <li key={i} className="flex justify-between py-2"><span>{r.workflow_key} via {r.provider}</span><span>{r.status}, {timeAgo(r.created_at)} ago</span></li>)}
        </ul>
      </section>
    </div>
  );
}
