import { NextRequest } from "next/server";
import { z } from "zod";
import { requireRole, requireUser, requireWallet } from "@/lib/server/auth";
import { env } from "@/lib/server/env";
import { audit, bad, body, forbidden, ok, route } from "@/lib/server/http";
import { createIntent } from "@/lib/server/intents";
import { assertPaiflowDeposit, paiflow, workflowId, WORKFLOW_KEYS } from "@/lib/server/paiflow";
import { ingestPaiflowEvents } from "@/lib/server/paiflow-sync";
import { db } from "@/lib/server/supabase";
import { formatAmount, toStroops } from "@/lib/stellar/amount";
import { network } from "@/lib/stellar/network";

const KEYS = WORKFLOW_KEYS;

/** Live capability discovery for each configured Paiflow deployment + recent verified events. */
export const GET = route(async (req: NextRequest) => {
  const c = await requireUser(req);
  requireRole(c, "admin");
  const pf = paiflow();
  const workflows = await Promise.all(
    KEYS.map(async (k) => {
      const id = workflowId(k);
      if (!id) return { key: k, configured: false };
      if (!pf) return { key: k, configured: true, error: "PAIFLOW_API_KEY missing" };
      try {
        const cap = await pf.capabilities(id);
        return { key: k, configured: true, deploymentId: id, network: cap.network, triggerType: cap.triggerType, execute: cap.operations.execute?.status ?? "unknown", events: cap.operations.events?.status ?? "unknown" };
      } catch (e) {
        return { key: k, configured: true, deploymentId: id, error: (e as Error).message };
      }
    }),
  );
  const events = (await db().from("ledger_events").select("event_id, tx_hash, topic, data, created_at").eq("source", "paiflow").order("created_at", { ascending: false }).limit(30)).data ?? [];
  return ok({ apiConfigured: !!pf, workflows, events });
});

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("sync") }),
  z.object({ action: z.literal("sweep"), workflow: z.enum(["FEES_USDC", "FEES_XLM"]), amount: z.string() }),
]);

/**
 * FEE SWEEP through Paiflow: the fee-collector wallet (held by an admin via
 * Privy) deposits accumulated platform fees into a Paiflow "On Receive USDC ->
 * Split" deployment that routes them to fixed treasury/community recipients.
 * Uses Paiflow's documented prepare -> wallet sign -> submit flow.
 */
export const POST = route(async (req: NextRequest) => {
  const c = await requireUser(req);
  requireRole(c, "admin");
  const b = await body(req, Body);
  if (b.action === "sync") return ok(await ingestPaiflowEvents());
  const from = requireWallet(c);
  if (from !== env().FEE_COLLECTOR_ADDRESS) throw forbidden("Sign in with the fee-collector wallet to sweep fees.");
  const pf = paiflow();
  const dep = workflowId(b.workflow);
  if (!pf || !dep) throw bad(`Configure PAIFLOW_API_KEY and PAIFLOW_${b.workflow}_WORKFLOW_ID first.`);
  const amount = toStroops(b.amount);
  const cap = await pf.capabilities(dep);
  if (cap.operations.execute?.status !== "supported") throw bad(`This Paiflow deployment cannot be executed by deposit (trigger: ${cap.triggerType}).`);
  if (cap.network !== network().name) throw bad("Paiflow deployment is on a different network.");
  const prepared = await pf.prepare(dep, { amountStroops: amount, from });
  // Trust-on-first-use pin of this deployment's trigger contract: a later
  // envelope calling any other contract is refused.
  const pinKey = `paiflow-trigger:${dep}`;
  const pinned = (await db().from("sync_cursors").select("cursor").eq("key", pinKey).maybeSingle()).data?.cursor ?? null;
  const { tx, triggerContract } = assertPaiflowDeposit(prepared, { from, amountStroops: amount, passphrase: network().passphrase, triggerContract: pinned });
  if (!pinned) await db().from("sync_cursors").insert({ key: pinKey, cursor: triggerContract });
  const run = await db().from("workflow_runs").insert({ workflow_key: "FEE_SWEEP", provider: "paiflow", deployment_id: dep, request_id: prepared.preparationRequestId, status: "prepared" }).select("id").single();
  const intent = await createIntent({
    caller: c, kind: "paiflow_deposit", provider: "paiflow", tx,
    payload: { deploymentId: dep, preparationRequestId: prepared.preparationRequestId, workflowRunId: run.data?.id, workflow: b.workflow },
    summary: {
      title: `Sweep ${formatAmount(amount, 7)} fees via Paiflow`,
      lines: [{ label: "Paiflow deployment", value: `${dep.slice(0, 8)}...` }, { label: "Routing", value: "Fixed recipients configured in Paiflow" }],
    },
  });
  if (run.data?.id) await db().from("workflow_runs").update({ intent_id: intent.intentId }).eq("id", run.data.id);
  await audit(c.profile.id, "paiflow.sweep.prepare", "workflow", dep, { amount: b.amount });
  return ok(intent);
});
