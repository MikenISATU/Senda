"use client";

import { ExternalLink } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import useSWR from "swr";
import { Chat } from "@/components/app/Chat";
import { Amount, Avatar, Notice, Spinner } from "@/components/ui/bits";
import { Modal } from "@/components/ui/Modal";
import { STATUS_LABEL, STEPS, stepIndex } from "@/lib/client/jobs";
import { useSession } from "@/lib/client/session";
import type { PreparedIntent, PublicProfile } from "@/lib/client/types";
import { uploadFile } from "@/lib/client/upload";
import { useTx } from "@/lib/client/useTx";

type Onchain = {
  status: string; amount: string; deadline: number; reviewPeriod: number; proofAt: number; proofHash: string | null; revisions: number;
  disputedAt: number; settleProposer: string | null; settleAmount: string; paidFreelancer: string; paidFee: string; refundedClient: string; feeBps: number;
};
type D = {
  job: { id: string; title: string; description: string; role: string | null; budget: string; agreed_amount: string | null; asset: string; deadline: string; status: string; client_id: string; freelancer_id: string | null };
  role: "client" | "freelancer" | "mediator" | "viewer";
  client: PublicProfile; freelancer: PublicProfile | null;
  applications: { id: string; note: string; proposed_amount: string | null; freelancer_id: string; freelancer?: PublicProfile; status: string }[];
  offers: { id: string; amount: string; asset: string; deadline: string; status: string; freelancer_id: string }[];
  escrow: { contract_id: string; fund_tx: string | null; client_address: string; freelancer_address: string; onchain: Onchain | null } | null;
  conversationId: string | null; now: number;
};


export default function JobPage() {
  const { id } = useParams<{ id: string }>();
  const { api, wallet, config } = useSession();
  const { run } = useTx();
  const router = useRouter();
  const { data, error, mutate } = useSWR(`/api/jobs/${id}`, (u: string) => api<D>(u), { refreshInterval: 15_000 });
  const [err, setErr] = useState<string | null>(null);
  const [offerFor, setOfferFor] = useState<{ id: string; username?: string | null; amount: string } | null>(null);
  const [splitFor, setSplitFor] = useState<"resolve_dispute" | "propose_settlement" | null>(null);
  const [tab, setTab] = useState<"details" | "chat">("details");

  if (error) return <div className="p-6"><Notice tone="danger">{(error as Error).message}</Notice></div>;
  if (!data) return <div className="p-6"><Spinner /></div>;
  const { job, role, escrow } = data;
  const oc = escrow?.onchain ?? null;
  const amount = job.agreed_amount ?? job.budget;
  const EXPLORER = `https://stellar.expert/explorer/${config?.network === "mainnet" ? "public" : "testnet"}`;
  const refresh = () => setTimeout(() => mutate(), 300);
  const act = (action: string, extra: Record<string, string> = {}) =>
    run(() => api<PreparedIntent>(`/api/jobs/${id}/escrow`, { body: { action, ...extra } }), { onConfirmed: refresh });
  const call = async (fn: () => Promise<unknown>) => { setErr(null); try { await fn(); mutate(); } catch (e) { setErr((e as Error).message); } };

  const deadlinePassed = oc ? data.now > oc.deadline : false;
  const reviewOver = oc && oc.proofAt ? data.now >= oc.proofAt + oc.reviewPeriod : false;
  const staleDispute = oc && oc.disputedAt ? data.now >= oc.disputedAt + 30 * 86400 : false;
  const active = oc && !["Paid", "Refunded", "Resolved"].includes(oc.status);
  const myPendingOffer = data.offers.find((o) => o.status === "pending" && role === "freelancer");
  const pendingForMe = data.offers.find((o) => o.status === "pending");

  return (
    <div className="mx-auto w-full max-w-[920px] px-4 md:px-6">
      <div className="pb-4 pt-5">
        <p className="text-sm text-slate"><Link href="/jobs" className="hover:underline">Jobs</Link></p>
        <h1 className="mt-1 text-2xl font-semibold md:text-3xl">{job.title}</h1>
        <p className="mt-1 text-slate"><Amount value={amount} asset={job.asset} decimals={7} /> due {new Date(job.deadline).toLocaleString()}</p>
      </div>

      <ol className="mb-5 grid grid-cols-5 gap-1" aria-label="Progress">
        {STEPS.map((s, i) => {
          const cur = stepIndex(job.status);
          return (
            <li key={s} aria-current={i === cur ? "step" : undefined} className="min-w-0">
              <span className={`block h-1.5 rounded-full ${i <= cur ? (job.status === "DISPUTED" && i === cur ? "bg-danger" : "bg-cobalt") : "bg-line"}`} />
              <span className={`mt-1 block truncate text-[11px] sm:text-xs ${i === cur ? "font-semibold text-ink" : "text-slate"}`}>{s}</span>
            </li>
          );
        })}
      </ol>

      {data.conversationId && (
        <div role="tablist" className="mb-3 flex gap-1">
          {(["details", "chat"] as const).map((t) => <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={`tap rounded-full px-4 text-sm font-semibold ${tab === t ? "bg-ink text-white" : "text-slate hover:bg-white"}`}>{t === "details" ? "Details" : "Job chat"}</button>)}
        </div>
      )}

      {tab === "chat" && data.conversationId ? <div className="sheet overflow-hidden"><Chat id={data.conversationId} /></div> : (
        <div className="space-y-4">
          <section className="sheet p-5" aria-labelledby="status-h">
            <h2 id="status-h" className="text-lg font-semibold">{STATUS_LABEL[job.status]}</h2>
            {err && <div className="mt-3"><Notice tone="danger">{err}</Notice></div>}
            <div className="mt-3 flex flex-wrap gap-2">
              {/* Open job */}
              {job.status === "DRAFT" && role === "client" && <button className="btn-outline" onClick={() => call(async () => { await api(`/api/jobs/${id}`, { method: "DELETE" }); router.push("/jobs"); })}>Cancel job</button>}
              {/* Offer */}
              {job.status === "OFFERED" && myPendingOffer && (
                <>
                  <p className="w-full">You're offered <b><Amount value={myPendingOffer.amount} asset={myPendingOffer.asset} decimals={7} /></b>, due {new Date(myPendingOffer.deadline).toLocaleString()}. Payment is locked in escrow before you start.</p>
                  <button className="btn-primary" onClick={() => call(() => api(`/api/jobs/${id}/respond`, { body: { offerId: myPendingOffer.id, accept: true } }))}>Accept offer</button>
                  <button className="btn-outline" onClick={() => call(() => api(`/api/jobs/${id}/respond`, { body: { offerId: myPendingOffer.id, accept: false } }))}>Decline</button>
                </>
              )}
              {job.status === "OFFERED" && role === "client" && pendingForMe && <p>Waiting for the freelancer to answer your offer.</p>}
              {/* Funding */}
              {job.status === "AWAITING_FUNDING" && role === "client" && (
                config?.escrowConfigured
                  ? <button className="btn-primary" onClick={() => run(() => api<PreparedIntent>(`/api/jobs/${id}/fund`, { body: {} }), { onConfirmed: refresh })}>Fund escrow with <Amount value={amount} asset={job.asset} decimals={7} /></button>
                  : <Notice tone="warn">The escrow contract is not configured on this server yet.</Notice>
              )}
              {job.status === "AWAITING_FUNDING" && role === "freelancer" && <p>Waiting for the client to lock the payment. Don't start work before the escrow is funded.</p>}
              {/* Funded */}
              {job.status === "FUNDED" && role === "freelancer" && <button className="btn-primary" onClick={() => call(() => api(`/api/jobs/${id}/start`, { body: {} }))}>Start work</button>}
              {role === "freelancer" && oc && ["Funded", "RevisionRequested"].includes(oc.status) && <ProofForm jobId={id} conversationId={data.conversationId} onDone={refresh} />}
              {/* Review */}
              {role === "client" && oc?.status === "ProofSubmitted" && (
                <>
                  <p className="w-full">The freelancer delivered. Review the proof in the job chat, then approve to release payment.</p>
                  <button className="btn-primary" onClick={() => act("approve")}>Approve and release payment</button>
                  <button className="btn-outline" onClick={() => act("request_revision")} disabled={(oc?.revisions ?? 0) >= 5}>Request revision</button>
                </>
              )}
              {role === "freelancer" && oc?.status === "ProofSubmitted" && (
                reviewOver ? <button className="btn-primary" onClick={() => act("claim_after_review")}>Claim payment</button>
                  : <p>Waiting for the client's review. If they don't respond by {new Date((oc.proofAt + oc.reviewPeriod) * 1000).toLocaleString()}, you can claim payment.</p>
              )}
              {/* Refund after deadline */}
              {active && deadlinePassed && oc && ["Funded", "RevisionRequested"].includes(oc.status) && (role === "client" || role === "freelancer") && (
                <button className="btn-outline" onClick={() => act("refund_expired")}>Refund client (deadline passed)</button>
              )}
              {/* Dispute */}
              {oc?.status === "Disputed" && (
                <>
                  <p className="w-full">A mediator can split the escrow between both of you. You can also agree on a split yourselves.</p>
                  {role === "mediator" && <button className="btn-primary" onClick={() => setSplitFor("resolve_dispute")}>Resolve dispute</button>}
                  {(role === "client" || role === "freelancer") && <button className="btn-outline" onClick={() => setSplitFor("propose_settlement")}>Propose a split</button>}
                  {staleDispute && <button className="btn-outline" onClick={() => act("resolve_stale_dispute")}>Settle 50/50 (mediator inactive 30 days)</button>}
                </>
              )}
              {oc?.settleProposer && (role === "client" || role === "freelancer") && oc.settleProposer !== wallet && (
                <button className="btn-primary" onClick={() => act("accept_settlement", { freelancerAmount: oc.settleAmount })}>Accept proposed split: freelancer gets <Amount value={oc.settleAmount} asset={job.asset} decimals={7} /></button>
              )}
              {active && oc?.status !== "Disputed" && (role === "client" || role === "freelancer") && <button className="btn-ghost text-danger" onClick={() => act("open_dispute")}>Open dispute</button>}
              {active && role === "freelancer" && oc?.status !== "Disputed" && <button className="btn-ghost" onClick={() => act("cancel_by_freelancer")}>Withdraw and refund client</button>}
            </div>
            {oc && ["Paid", "Refunded", "Resolved"].includes(oc.status) && (
              <dl className="mt-4 divide-y divide-line rounded-xl border border-line text-sm">
                <Row k="Freelancer received" v={<Amount value={oc.paidFreelancer} asset={job.asset} decimals={7} />} />
                <Row k="Platform fee" v={<Amount value={oc.paidFee} asset={job.asset} decimals={7} />} />
                <Row k="Refunded to client" v={<Amount value={oc.refundedClient} asset={job.asset} decimals={7} />} />
              </dl>
            )}
          </section>

          {escrow && (
            <section className="sheet p-5" aria-labelledby="chain-h">
              <h2 id="chain-h" className="text-lg font-semibold">On-chain escrow</h2>
              <p className="text-sm text-slate">The contract holds the funds and enforces every rule. This page only reads it.</p>
              <dl className="mt-3 divide-y divide-line rounded-xl border border-line text-sm">
                <Row k="Contract" v={<a className="link inline-flex items-center gap-1" href={`${EXPLORER}/contract/${escrow.contract_id}`} target="_blank" rel="noreferrer">{escrow.contract_id.slice(0, 6)}...{escrow.contract_id.slice(-6)} <ExternalLink size={12} aria-hidden /></a>} />
                <Row k="Status" v={oc?.status ?? "Not funded"} />
                {oc && <Row k="Locked" v={<Amount value={oc.amount} asset={job.asset} decimals={7} />} />}
                {oc && <Row k="Fee on release" v={`${oc.feeBps / 100}%`} />}
                {oc?.proofHash && <Row k="Proof hash" v={<span className="tabular break-all">{oc.proofHash.slice(0, 20)}...</span>} />}
                {escrow.fund_tx && <Row k="Funding tx" v={<a className="link" href={`${EXPLORER}/tx/${escrow.fund_tx}`} target="_blank" rel="noreferrer">{escrow.fund_tx.slice(0, 10)}...</a>} />}
              </dl>
            </section>
          )}

          <section className="sheet p-5" aria-labelledby="desc-h">
            <h2 id="desc-h" className="text-lg font-semibold">Brief</h2>
            <p className="mt-2 flex items-center gap-2 text-sm text-slate"><Avatar src={data.client?.avatar_url} name={data.client?.username} size={22} /> Client <Link className="link" href={`/u/${data.client?.username}`}>@{data.client?.username}</Link>{data.freelancer && <> , freelancer <Link className="link" href={`/u/${data.freelancer.username}`}>@{data.freelancer.username}</Link></>}</p>
            {job.role && <p className="mt-2 text-sm"><b>Role:</b> {job.role}</p>}
            <p className="mt-3 max-w-prose whitespace-pre-wrap">{job.description}</p>
          </section>

          {job.status === "DRAFT" && role === "viewer" && <ApplyForm jobId={id} applied={data.applications.length > 0} onDone={() => mutate()} />}

          {role === "client" && job.status === "DRAFT" && (
            <section className="sheet p-5" aria-labelledby="apps-h">
              <h2 id="apps-h" className="text-lg font-semibold">Applications ({data.applications.length})</h2>
              {data.applications.length === 0 ? <p className="mt-2 text-slate">No applications yet. Share the job link so freelancers can find it.</p> : (
                <ul className="mt-3 divide-y divide-line">
                  {data.applications.map((a) => (
                    <li key={a.id} className="py-3">
                      <div className="flex items-center justify-between gap-3">
                        <Link href={`/u/${a.freelancer?.username}`} className="flex items-center gap-2 font-semibold hover:underline"><Avatar src={a.freelancer?.avatar_url} name={a.freelancer?.username} size={28} />@{a.freelancer?.username}</Link>
                        {a.proposed_amount && <Amount value={a.proposed_amount} asset={job.asset} decimals={7} />}
                      </div>
                      <p className="mt-1 whitespace-pre-wrap text-sm">{a.note}</p>
                      <button className="btn-outline mt-2" onClick={() => setOfferFor({ id: a.freelancer_id, username: a.freelancer?.username, amount: a.proposed_amount ?? job.budget })}>Send offer</button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}
        </div>
      )}

      {offerFor && <OfferModal jobId={id} asset={job.asset} target={offerFor} defaultDeadline={job.deadline} onClose={() => setOfferFor(null)} onDone={() => { setOfferFor(null); mutate(); }} />}
      {splitFor && oc && (
        <SplitModal title={splitFor === "resolve_dispute" ? "Resolve dispute" : "Propose a split"} total={oc.amount} asset={job.asset} onClose={() => setSplitFor(null)}
          onSubmit={(v) => { setSplitFor(null); act(splitFor, { freelancerAmount: v }); }} />
      )}
    </div>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return <div className="flex items-start justify-between gap-4 px-3.5 py-2.5"><dt className="text-slate">{k}</dt><dd className="text-right font-semibold">{v}</dd></div>;
}

function ApplyForm({ jobId, applied, onDone }: { jobId: string; applied: boolean; onDone: () => void }) {
  const { api } = useSession();
  const [note, setNote] = useState("");
  const [amt, setAmt] = useState("");
  const [err, setErr] = useState<string | null>(null);
  if (applied) return <Notice tone="success">You applied. The client will send an offer if it's a fit.</Notice>;
  return (
    <section className="sheet p-5" aria-labelledby="apply-h">
      <h2 id="apply-h" className="text-lg font-semibold">Apply</h2>
      <form className="mt-3 space-y-3" onSubmit={async (e) => { e.preventDefault(); setErr(null); try { await api(`/api/jobs/${jobId}/apply`, { body: { note, proposedAmount: amt || undefined } }); onDone(); } catch (x) { setErr((x as Error).message); } }}>
        <div><label className="label" htmlFor="note">Why you're a fit</label><textarea id="note" className="field min-h-24 py-2.5" value={note} onChange={(e) => setNote(e.target.value)} required maxLength={2000} /></div>
        <div className="sm:max-w-xs"><label className="label" htmlFor="pa">Your price (optional)</label><input id="pa" className="field tabular" inputMode="decimal" value={amt} onChange={(e) => setAmt(e.target.value)} /></div>
        {err && <Notice tone="danger">{err}</Notice>}
        <button className="btn-primary">Send application</button>
      </form>
    </section>
  );
}

function OfferModal({ jobId, asset, target, defaultDeadline, onClose, onDone }: { jobId: string; asset: string; target: { id: string; username?: string | null; amount: string }; defaultDeadline: string; onClose: () => void; onDone: () => void }) {
  const { api } = useSession();
  const [amount, setAmount] = useState(target.amount);
  const [deadline, setDeadline] = useState(defaultDeadline.slice(0, 16));
  const [err, setErr] = useState<string | null>(null);
  return (
    <Modal open onClose={onClose} title={`Offer to @${target.username}`}>
      <form className="space-y-3" onSubmit={async (e) => { e.preventDefault(); setErr(null); try { await api(`/api/jobs/${jobId}/offer`, { body: { freelancerId: target.id, amount, deadline: new Date(deadline).toISOString() } }); onDone(); } catch (x) { setErr((x as Error).message); } }}>
        <div><label className="label" htmlFor="oa">Amount ({asset})</label><input id="oa" className="field tabular" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} required /></div>
        <div><label className="label" htmlFor="od">Deadline</label><input id="od" type="datetime-local" className="field" value={deadline} onChange={(e) => setDeadline(e.target.value)} required /></div>
        <p className="text-sm text-slate">If they accept, you lock exactly this amount in the escrow contract before work starts.</p>
        {err && <Notice tone="danger">{err}</Notice>}
        <button className="btn-primary w-full">Send offer</button>
      </form>
    </Modal>
  );
}

function SplitModal({ title, total, asset, onClose, onSubmit }: { title: string; total: string; asset: string; onClose: () => void; onSubmit: (freelancerAmount: string) => void }) {
  const [v, setV] = useState("");
  return (
    <Modal open onClose={onClose} title={title}>
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); onSubmit(v); }}>
        <p className="text-sm text-slate">Escrow holds <b><Amount value={total} asset={asset} decimals={7} /></b>. Enter the freelancer's share; the rest returns to the client. The platform fee applies to the freelancer's share only.</p>
        <div><label className="label" htmlFor="sv">Freelancer share</label><input id="sv" className="field tabular" inputMode="decimal" value={v} onChange={(e) => setV(e.target.value)} required /></div>
        <button className="btn-primary w-full">Review</button>
      </form>
    </Modal>
  );
}

function ProofForm({ jobId, conversationId, onDone }: { jobId: string; conversationId: string | null; onDone: () => void }) {
  const { api } = useSession();
  const { run } = useTx();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (!open) return <button className="btn-primary" onClick={() => setOpen(true)}>Submit proof of work</button>;
  return (
    <form className="w-full space-y-3 rounded-xl border border-line p-4" onSubmit={async (e) => {
      e.preventDefault(); setBusy(true); setErr(null);
      try {
        const ids: string[] = [];
        for (const f of files) {
          if (!conversationId) throw new Error("Job chat missing");
          const s = await uploadFile(api, f, "chat", conversationId);
          const a = await api<{ id: string }>(`/api/conversations/${conversationId}/attachments`, { body: { path: s.path, fileName: f.name, mime: f.type || "application/octet-stream" } });
          ids.push(a.id);
        }
        setOpen(false);
        run(() => api<PreparedIntent>(`/api/jobs/${jobId}/proof`, { body: { note, attachmentIds: ids } }), { onConfirmed: onDone });
      } catch (x) { setErr((x as Error).message); } finally { setBusy(false); }
    }}>
      <div><label className="label" htmlFor="pn">What you delivered</label><textarea id="pn" className="field min-h-24 py-2.5" value={note} onChange={(e) => setNote(e.target.value)} required maxLength={2000} /></div>
      <div><label className="label" htmlFor="pf">Evidence files</label><input id="pf" type="file" multiple onChange={(e) => setFiles(Array.from(e.target.files ?? []).slice(0, 10))} className="block text-sm" /><p className="hint">Files are hashed on the server; the combined hash is recorded on-chain.</p></div>
      {err && <Notice tone="danger">{err}</Notice>}
      <div className="flex gap-2"><button className="btn-primary" disabled={busy}>{busy ? "Uploading" : "Review and submit"}</button><button type="button" className="btn-ghost" onClick={() => setOpen(false)}>Cancel</button></div>
    </form>
  );
}
