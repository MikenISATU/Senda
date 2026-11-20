import "server-only";
import { createHash } from "node:crypto";
import { Address, nativeToScVal, scValToNative, xdr } from "@stellar/stellar-sdk";
import { fromStroops } from "@/lib/stellar/amount";
import { buildContractCallTx, scAddress, simulateRead } from "@/lib/stellar/tx";
import { requireEnv } from "./env";
import { db, must } from "./supabase";

export const ONCHAIN_STATUS = ["Funded", "ProofSubmitted", "RevisionRequested", "Disputed", "Paid", "Refunded", "Resolved"] as const;
export type OnchainStatus = (typeof ONCHAIN_STATUS)[number];

const TO_JOB_STATUS: Record<OnchainStatus, string> = {
  Funded: "FUNDED",
  ProofSubmitted: "PROOF_SUBMITTED",
  RevisionRequested: "REVISION_REQUESTED",
  Disputed: "DISPUTED",
  Paid: "PAID",
  Refunded: "REFUNDED",
  Resolved: "RESOLVED",
};

export function escrowContractId() {
  return requireEnv("SOROBAN_JOB_ESCROW_CONTRACT_ID").SOROBAN_JOB_ESCROW_CONTRACT_ID;
}

/** Per-job salt passed to `fund` (deterministic per contract + job). */
export function escrowSalt(jobId: string, contractId: string) {
  return createHash("sha256").update(`senda:job:${contractId}:${jobId}`).digest("hex");
}

/**
 * The contract's job id: sha256(ScVal XDR of client address || salt). Mirrors
 * `derive_job_id` in contracts/job_escrow (cross-checked by tests in both
 * languages). Because the client address is part of the id, nobody else can
 * pre-register ("squat") it.
 */
export function onchainJobId(client: string, saltHex: string) {
  const addr = Buffer.from(new Address(client).toScVal().toXDR());
  return createHash("sha256").update(Buffer.concat([addr, Buffer.from(saltHex, "hex")])).digest("hex");
}


const bytes32 = (hex: string) => xdr.ScVal.scvBytes(Buffer.from(hex, "hex"));
const i128 = (v: bigint) => nativeToScVal(v, { type: "i128" });
const u64 = (v: number | bigint) => nativeToScVal(BigInt(v), { type: "u64" });

export function buildFundTx(a: { client: string; freelancer: string; salt: string; token: string; amount: bigint; deadlineUnix: number }) {
  return buildContractCallTx(a.client, escrowContractId(), "fund", [
    bytes32(a.salt), scAddress(a.client), scAddress(a.freelancer), scAddress(a.token), i128(a.amount), u64(a.deadlineUnix),
  ]);
}

export type EscrowAction =
  | { action: "submit_proof"; proofHash: string }
  | { action: "request_revision" }
  | { action: "approve" }
  | { action: "claim_after_review" }
  | { action: "refund_expired" }
  | { action: "cancel_by_freelancer" }
  | { action: "open_dispute" }
  | { action: "resolve_dispute"; freelancerAmount: bigint }
  | { action: "resolve_stale_dispute" }
  | { action: "propose_settlement"; freelancerAmount: bigint }
  | { action: "accept_settlement"; freelancerAmount: bigint };

export function buildActionTx(signer: string, key: string, a: EscrowAction) {
  const id = bytes32(key);
  const args: xdr.ScVal[] = (() => {
    switch (a.action) {
      case "submit_proof": return [id, bytes32(a.proofHash)];
      case "open_dispute": return [id, scAddress(signer)];
      case "resolve_dispute": return [id, i128(a.freelancerAmount)];
      case "propose_settlement":
      case "accept_settlement": return [id, scAddress(signer), i128(a.freelancerAmount)];
      default: return [id];
    }
  })();
  return buildContractCallTx(signer, escrowContractId(), a.action, args);
}

export type OnchainJob = {
  client: string;
  freelancer: string;
  token: string;
  amount: string;
  feeBps: number;
  status: OnchainStatus;
  deadline: number;
  reviewPeriod: number;
  proofHash: string | null;
  proofAt: number;
  revisions: number;
  disputedAt: number;
  settleProposer: string | null;
  settleAmount: string;
  paidFreelancer: string;
  paidFee: string;
  refundedClient: string;
};

/** Reads the authoritative job record from the contract (simulation, no fee). */
export async function readOnchainJob(key: string): Promise<OnchainJob | null> {
  const v = await simulateRead(escrowContractId(), "get_job", [bytes32(key)]);
  if (!v) return null;
  const j = scValToNative(v) as Record<string, unknown> | null | undefined;
  if (!j) return null;
  const big = (x: unknown) => fromStroops(BigInt(x as bigint));
  const statusIdx = Array.isArray(j.status) ? ONCHAIN_STATUS.indexOf((j.status as string[])[0] as OnchainStatus) : Number(j.status);
  return {
    client: String(j.client),
    freelancer: String(j.freelancer),
    token: String(j.token),
    amount: big(j.amount),
    feeBps: Number(j.fee_bps),
    status: ONCHAIN_STATUS[statusIdx],
    deadline: Number(j.deadline),
    reviewPeriod: Number(j.review_period),
    proofHash: j.proof_hash ? Buffer.from(j.proof_hash as Uint8Array).toString("hex") : null,
    proofAt: Number(j.proof_at),
    revisions: Number(j.revisions),
    disputedAt: Number(j.disputed_at),
    settleProposer: (j.settle_proposer as string | null) ?? null,
    settleAmount: big(j.settle_amount ?? 0n),
    paidFreelancer: big(j.paid_freelancer),
    paidFee: big(j.paid_fee),
    refundedClient: big(j.refunded_client),
  };
}

/** Pulls on-chain state into the cache tables. The DB never overrides the chain. */
export async function syncEscrow(jobId: string) {
  const esc = must(await db().from("escrows").select("escrow_key, job_id, client_address, freelancer_address, token_contract, amount").eq("job_id", jobId).maybeSingle()) as
    | { escrow_key: string; client_address: string; freelancer_address: string; token_contract: string; amount: string }
    | null;
  if (!esc) return null;
  const onchain = await readOnchainJob(esc.escrow_key);
  if (!onchain) return null;
  // Never trust an on-chain record that differs from the agreed terms.
  if (
    onchain.client !== esc.client_address ||
    onchain.freelancer !== esc.freelancer_address ||
    onchain.token !== esc.token_contract ||
    Number(onchain.amount) !== Number(esc.amount)
  ) {
    console.error("[escrow] on-chain record does not match agreed terms", jobId);
    await db().from("escrows").update({ onchain_status: "MISMATCH", onchain, last_synced_at: new Date().toISOString() }).eq("job_id", jobId);
    return null;
  }
  await db().from("escrows").update({ onchain_status: onchain.status, onchain, last_synced_at: new Date().toISOString() }).eq("job_id", jobId);
  const job = must(await db().from("jobs").select("status").eq("id", jobId).single()) as { status: string };
  let next = TO_JOB_STATUS[onchain.status];
  // IN_PROGRESS is an app-level marker on top of on-chain Funded.
  if (onchain.status === "Funded" && job.status === "IN_PROGRESS") next = "IN_PROGRESS";
  if (next !== job.status) await db().from("jobs").update({ status: next }).eq("id", jobId);
  return onchain;
}
