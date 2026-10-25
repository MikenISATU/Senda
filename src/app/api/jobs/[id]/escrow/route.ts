import { NextRequest } from "next/server";
import { z } from "zod";
import { requireUser, requireWallet } from "@/lib/server/auth";
import { buildActionTx, readOnchainJob, type EscrowAction } from "@/lib/server/escrow";
import { bad, body, forbidden, ok, rateLimit, route } from "@/lib/server/http";
import { createIntent } from "@/lib/server/intents";
import { loadJob, requireParty } from "@/lib/server/jobs";
import { db, must } from "@/lib/server/supabase";
import { formatAmount, toStroops } from "@/lib/stellar/amount";

const Body = z.object({
  action: z.enum(["request_revision", "approve", "claim_after_review", "refund_expired", "cancel_by_freelancer", "open_dispute", "resolve_dispute", "resolve_stale_dispute", "propose_settlement", "accept_settlement"]),
  freelancerAmount: z.string().optional(),
});

const WHO: Record<string, ("client" | "freelancer" | "mediator")[]> = {
  request_revision: ["client"],
  approve: ["client"],
  refund_expired: ["client", "freelancer"],
  claim_after_review: ["freelancer"],
  cancel_by_freelancer: ["freelancer"],
  open_dispute: ["client", "freelancer"],
  propose_settlement: ["client", "freelancer"],
  accept_settlement: ["client", "freelancer"],
  resolve_dispute: ["mediator"],
  resolve_stale_dispute: ["client", "freelancer", "mediator"],
};

const TITLES: Record<string, string> = {
  request_revision: "Request a revision",
  approve: "Approve work and release payment",
  claim_after_review: "Claim payment (review window passed)",
  refund_expired: "Refund client (deadline passed)",
  cancel_by_freelancer: "Withdraw and refund the client",
  open_dispute: "Open a dispute",
  resolve_dispute: "Resolve dispute",
  resolve_stale_dispute: "Settle stale dispute 50/50",
  propose_settlement: "Propose a settlement",
  accept_settlement: "Accept settlement",
};

/** Builds a user-signed escrow contract call. The contract enforces every rule; this route only pre-checks for clear errors. */
export const POST = route(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const c = await requireUser(req);
  const signer = requireWallet(c);
  await rateLimit(`escrow:${c.profile.id}`, 20, 60);
  const b = await body(req, Body);
  const job = await loadJob(id);
  const role = requireParty(job, c, ...WHO[b.action]);
  const esc = must(await db().from("escrows").select("escrow_key, contract_id, amount, asset").eq("job_id", id).maybeSingle()) as { escrow_key: string; amount: string; asset: string } | null;
  if (!esc) throw bad("This job has no escrow.");
  const onchain = await readOnchainJob(esc.escrow_key);
  if (!onchain) throw bad("Escrow not funded on-chain yet.");
  if (role === "mediator" && b.action === "resolve_dispute") {
    // Contract checks the configured mediator signature; surface a clear error first.
    const { data } = await db().from("profiles").select("role").eq("id", c.profile.id).single();
    if (!data || !["mediator", "admin"].includes(data.role)) throw forbidden();
  }
  let action: EscrowAction;
  let extra: { label: string; value: string }[] = [];
  if (b.action === "resolve_dispute" || b.action === "propose_settlement" || b.action === "accept_settlement") {
    if (!b.freelancerAmount) throw bad("Enter the freelancer's share.");
    const fa = toStroops(b.freelancerAmount);
    if (fa > toStroops(onchain.amount)) throw bad("Share exceeds the escrowed amount.");
    action = { action: b.action, freelancerAmount: fa };
    extra = [
      { label: "Freelancer share (before fee)", value: `${formatAmount(fa, 7)} ${esc.asset}` },
      { label: "Client refund", value: `${formatAmount(toStroops(onchain.amount) - fa, 7)} ${esc.asset}` },
    ];
  } else {
    action = { action: b.action } as EscrowAction;
  }
  const tx = await buildActionTx(signer, esc.escrow_key, action);
  return ok(
    await createIntent({
      caller: c, kind: "escrow_action", provider: "soroban", tx,
      payload: { jobId: id, action: b.action },
      summary: {
        title: TITLES[b.action],
        lines: [{ label: "Job", value: job.title }, { label: "Escrowed", value: `${onchain.amount} ${esc.asset}` }, { label: "On-chain status", value: onchain.status }, ...extra],
      },
    }),
  );
});
