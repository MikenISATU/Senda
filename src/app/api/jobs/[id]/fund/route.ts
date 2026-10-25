import { NextRequest } from "next/server";
import { requireUser, requireWallet, walletOf } from "@/lib/server/auth";
import { buildFundTx, escrowContractId, escrowSalt, onchainJobId } from "@/lib/server/escrow";
import { bad, forbidden, ok, rateLimit, route } from "@/lib/server/http";
import { createIntent } from "@/lib/server/intents";
import { loadJob } from "@/lib/server/jobs";
import { db, must } from "@/lib/server/supabase";
import { getBalances } from "@/lib/stellar/account";
import { formatAmount, toStroops } from "@/lib/stellar/amount";
import { assetContractId } from "@/lib/stellar/network";

/**
 * JOB_FUND workflow: the client signs a Soroban `fund` call that moves the
 * exact agreed amount into the job_escrow contract. Release, refund and
 * dispute rules are enforced by the contract, never by a webhook or this server.
 */
export const POST = route(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const c = await requireUser(req);
  const client = requireWallet(c);
  await rateLimit(`fund:${c.profile.id}`, 10, 60);
  const job = await loadJob(id);
  if (job.client_id !== c.profile.id) throw forbidden("Only the client funds the escrow.");
  if (job.status !== "AWAITING_FUNDING") throw bad("This job is not waiting for funding.");
  if (!job.freelancer_id || !job.agreed_amount) throw bad("No accepted offer.");
  const freelancer = await walletOf(job.freelancer_id);
  if (!freelancer) throw bad("The freelancer has no wallet.");
  const contractId = escrowContractId();
  const token = assetContractId(job.asset);
  const amount = toStroops(job.agreed_amount);
  const bal = await getBalances(client);
  const have = job.asset === "XLM" ? bal.xlmAvailable : bal.usdc ?? "0";
  if (toStroops(trim7(have)) < amount) throw bad(`Not enough ${job.asset}. You need ${formatAmount(amount, 7)} ${job.asset} plus network fees.`);
  const salt = escrowSalt(job.id, contractId);
  const key = onchainJobId(client, salt);
  const deadlineUnix = Math.floor(new Date(job.deadline).getTime() / 1000);
  const existing = (await db().from("escrows").select("fund_tx").eq("job_id", id).maybeSingle()).data;
  if (existing?.fund_tx) throw bad("Escrow already funded.");
  must(
    await db().from("escrows").upsert(
      { job_id: id, contract_id: contractId, escrow_key: key, client_address: client, freelancer_address: freelancer, token_contract: token, asset: job.asset, amount: job.agreed_amount },
      { onConflict: "job_id" },
    ),
  );
  const tx = await buildFundTx({ client, freelancer, salt, token, amount, deadlineUnix });
  const intent = await createIntent({
    caller: c, kind: "escrow_fund", provider: "soroban", tx,
    payload: { jobId: id, escrowKey: key },
    summary: {
      title: `Lock ${formatAmount(amount, 7)} ${job.asset} in escrow`,
      lines: [
        { label: "Job", value: job.title },
        { label: "Escrow contract", value: `${contractId.slice(0, 6)}...${contractId.slice(-6)}` },
        { label: "Deadline", value: new Date(job.deadline).toUTCString() },
        { label: "Release", value: "Only by your approval, review timeout, refund rules or mediator" },
      ],
      feeNote: `Network fee up to ${(Number(tx.fee) / 1e7).toFixed(5)} XLM (includes Soroban resources)`,
    },
  });
  await db().from("workflow_runs").insert({ workflow_key: "JOB_FUND", provider: "soroban", intent_id: intent.intentId, status: "prepared" });
  return ok(intent);
});

function trim7(v: string) {
  const [w, f = ""] = v.split(".");
  return f ? `${w}.${f.slice(0, 7)}` : w;
}
