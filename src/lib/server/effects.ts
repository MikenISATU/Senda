import "server-only";
import type { SubmitResult } from "@/lib/stellar/tx";
import type { IntentRow } from "./intents";
import { syncEscrow } from "./escrow";
import { db } from "./supabase";

/**
 * Business side effects of a CONFIRMED on-chain transaction. Every branch is
 * idempotent: the reconciler and status polling may call this more than once.
 * Entitlements and tips use guarded SQL functions that act exactly once.
 */
export async function onConfirmed(intent: IntentRow, result: SubmitResult) {
  const p = intent.payload as Record<string, string>;
  const hash = result.hash;
  switch (intent.kind) {
    case "purchase": {
      const { error } = await db().rpc("confirm_purchase", { p_intent_id: intent.id, p_tx_hash: hash });
      if (error) throw new Error(`confirm_purchase: ${error.message}`);
      break;
    }
    case "tip": {
      const { error } = await db().rpc("confirm_tip", { p_intent_id: intent.id, p_tx_hash: hash });
      if (error) throw new Error(`confirm_tip: ${error.message}`);
      break;
    }
    case "payment": {
      if (p.requestId) {
        // Money moved, so record it as paid even if the request was closed meanwhile.
        const { data: settled } = await db()
          .from("payment_requests")
          .update({ status: "paid", tx_hash: hash, settled_at: new Date().toISOString() })
          .eq("id", p.requestId)
          .neq("status", "paid")
          .select("conversation_id, amount, asset");
        const row = settled?.[0] as { conversation_id: string; amount: string; asset: string } | undefined;
        if (row) {
          await db().from("messages").insert({ conversation_id: row.conversation_id, sender_id: null, kind: "system", body: `Request paid: ${Number(row.amount)} ${row.asset}. Tx ${hash.slice(0, 10)}...` });
        }
      }
      if (p.recipientProfileId) {
        const { data: existing } = await db().from("notifications").select("id").eq("profile_id", p.recipientProfileId).eq("entity_id", hash).maybeSingle();
        if (!existing) {
          await db().from("notifications").insert({
            profile_id: p.recipientProfileId,
            type: "payment",
            actor_id: intent.profile_id,
            entity_type: "tx",
            entity_id: hash,
            body: `You received ${p.amount} ${p.asset}`,
          });
        }
      }
      break;
    }
    case "escrow_fund": {
      await db().from("escrows").update({ fund_tx: hash, last_tx: hash }).eq("job_id", p.jobId);
      await db().from("jobs").update({ status: "FUNDED" }).eq("id", p.jobId).in("status", ["ACCEPTED", "AWAITING_FUNDING"]);
      await syncEscrow(p.jobId).catch(() => null);
      await systemMessage(p.jobId, `Escrow funded on-chain. Funds are locked until release, refund or dispute resolution. Tx ${hash.slice(0, 10)}...`);
      break;
    }
    case "escrow_action": {
      await db().from("escrows").update({ last_tx: hash }).eq("job_id", p.jobId);
      if (p.action === "submit_proof" && p.conversationId) {
        const ids = (intent.payload.attachmentIds as string[] | undefined) ?? [];
        const { data: msg } = await db()
          .from("messages")
          .insert({ conversation_id: p.conversationId, sender_id: p.freelancerId, kind: "proof", body: `Proof of work\n${p.note}\nEvidence hash: ${p.proofHash}` })
          .select("id")
          .single();
        if (msg && ids.length) await db().from("attachments").update({ message_id: msg.id, is_evidence: true }).in("id", ids).eq("uploader_id", p.freelancerId);
      }
      await syncEscrow(p.jobId).catch(() => null);
      await systemMessage(p.jobId, `${labelFor(p.action)} confirmed on-chain. Tx ${hash.slice(0, 10)}...`);
      break;
    }
    case "earn_supply":
    case "earn_withdraw": {
      const sign = intent.kind === "earn_supply" ? 1 : -1;
      const { data } = await db().from("earn_positions").select("net_deposited").eq("profile_id", intent.profile_id).eq("pool_id", p.poolId).eq("asset_contract", p.assetContract).maybeSingle();
      const current = Number(data?.net_deposited ?? 0);
      const next = Math.max(0, current + sign * Number(p.amount));
      await db().from("earn_positions").upsert({ profile_id: intent.profile_id, pool_id: p.poolId, asset_contract: p.assetContract, net_deposited: next.toFixed(7), updated_at: new Date().toISOString() });
      break;
    }
    default:
      break;
  }
  // intent_id is the common link for every tracked flow (send, request, tip,
  // purchase, job escrow and Paiflow). Some older intents also carry a run id.
  await db().from("workflow_runs").update({ status: "confirmed", tx_hash: hash }).eq("intent_id", intent.id);
  if (p.workflowRunId) await db().from("workflow_runs").update({ status: "confirmed", tx_hash: hash }).eq("id", p.workflowRunId);
}

export async function onFailed(intent: IntentRow) {
  const p = intent.payload as Record<string, string>;
  if (intent.kind === "purchase") await db().from("purchases").update({ status: "failed" }).eq("intent_id", intent.id).eq("status", "pending");
  if (intent.kind === "tip") await db().from("tips").update({ status: "failed" }).eq("intent_id", intent.id).eq("status", "pending");
  await db().from("workflow_runs").update({ status: "failed" }).eq("intent_id", intent.id);
  if (p.workflowRunId) await db().from("workflow_runs").update({ status: "failed" }).eq("id", p.workflowRunId);
}

function labelFor(action: string) {
  return (
    {
      submit_proof: "Proof of work submitted",
      request_revision: "Revision requested",
      approve: "Work approved and payment released",
      claim_after_review: "Payment claimed after review window",
      refund_expired: "Refund after deadline",
      cancel_by_freelancer: "Freelancer cancelled; client refunded",
      open_dispute: "Dispute opened",
      resolve_dispute: "Dispute resolved by mediator",
      resolve_stale_dispute: "Stale dispute settled 50/50",
      propose_settlement: "Settlement proposed",
      accept_settlement: "Settlement accepted and paid out",
    } as Record<string, string>
  )[action] ?? action;
}

export async function systemMessage(jobId: string, body: string) {
  const { data } = await db().from("conversations").select("id").eq("job_id", jobId).maybeSingle();
  if (data) await db().from("messages").insert({ conversation_id: data.id, sender_id: null, kind: "system", body });
}
