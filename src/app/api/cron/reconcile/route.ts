import { timingSafeEqual } from "node:crypto";
import { NextRequest } from "next/server";
import { earnConfig, readReserve, snapshotRate } from "@/lib/server/earn";
import { env } from "@/lib/server/env";
import { syncEscrow } from "@/lib/server/escrow";
import { HttpError, ok, route } from "@/lib/server/http";
import { refreshIntent, type IntentRow } from "@/lib/server/intents";
import { ingestPaiflowEvents } from "@/lib/server/paiflow-sync";
import { db } from "@/lib/server/supabase";
import { getPaymentHistory } from "@/lib/stellar/account";

export const maxDuration = 60;

function authorized(req: NextRequest) {
  const secret = env().CRON_SECRET;
  const got = req.headers.get("authorization")?.replace("Bearer ", "") ?? "";
  if (!secret || got.length !== secret.length) return false;
  return timingSafeEqual(Buffer.from(got), Buffer.from(secret));
}

/**
 * Reconciler. Safe to run any number of times:
 *  1. resolves submitted intents by their ORIGINAL hash (never re-signs)
 *  2. expires unsigned intents past their time bounds
 *  3. re-syncs active escrows from the contract
 *  4. snapshots the lending pool b_rate (for measured APY)
 *  5. ingests + verifies Paiflow events
 *  6. indexes incoming payments into transfers + notifications
 */
export const GET = route(async (req: NextRequest) => {
  if (!authorized(req)) throw new HttpError(401, "Unauthorized", "UNAUTHENTICATED");
  const report: Record<string, unknown> = {};

  const pending = ((await db().from("tx_intents").select("*").eq("status", "submitted").lt("submitted_at", new Date(Date.now() - 10_000).toISOString()).limit(50)).data ?? []) as IntentRow[];
  let resolved = 0;
  for (const i of pending) {
    try {
      const r = await refreshIntent(i);
      if (r.status !== "submitted") resolved++;
    } catch (e) {
      console.error("[reconcile] intent", i.id, (e as Error).message);
    }
  }
  report.intents = { checked: pending.length, resolved };

  const exp = await db().from("tx_intents").update({ status: "expired" }).eq("status", "prepared").lt("expires_at", new Date().toISOString()).select("id");
  report.expired = exp.data?.length ?? 0;

  const activeJobs = ((await db().from("jobs").select("id").in("status", ["AWAITING_FUNDING", "FUNDED", "IN_PROGRESS", "PROOF_SUBMITTED", "REVISION_REQUESTED", "DISPUTED"]).limit(50)).data ?? []) as { id: string }[];
  const withEscrow = new Set((((await db().from("escrows").select("job_id").in("job_id", activeJobs.map((j) => j.id))).data ?? []) as { job_id: string }[]).map((e) => e.job_id));
  const active = activeJobs.filter((j) => withEscrow.has(j.id));
  for (const j of active) await syncEscrow(j.id).catch(() => null);
  report.escrowsSynced = active.length;

  try {
    const cfg = earnConfig();
    if (cfg.poolId && cfg.assetContract) {
      const r = await readReserve(cfg.poolId, cfg.assetContract);
      await snapshotRate(cfg.poolId, cfg.assetContract, r.bRate);
      report.earnSnapshot = true;
    }
  } catch (e) {
    report.earnSnapshot = (e as Error).message;
  }

  try {
    report.paiflow = await ingestPaiflowEvents(3);
  } catch (e) {
    report.paiflow = (e as Error).message;
  }

  const wallets = ((await db().from("linked_wallets").select("profile_id, address").eq("network", env().STELLAR_NETWORK).order("verified_at", { ascending: true }).limit(500)).data ?? []) as { profile_id: string; address: string }[];
  // Rotate through wallets: process those with the oldest cursor timestamp first.
  const cursors = new Map((((await db().from("sync_cursors").select("key, updated_at").like("key", "payments:%")).data ?? []) as { key: string; updated_at: string }[]).map((r) => [r.key, r.updated_at]));
  const batch = wallets.sort((a, b) => (cursors.get(`payments:${a.address}`) ?? "").localeCompare(cursors.get(`payments:${b.address}`) ?? "")).slice(0, 20);
  let indexed = 0;
  for (const w of batch) {
    try {
      const key = `payments:${w.address}`;
      const page = await getPaymentHistory(w.address, 50);
      for (const it of page.items) {
        const { error } = await db().from("transfers").insert({
          profile_id: w.profile_id, direction: it.direction, counterparty: it.counterparty, asset: it.asset, amount: it.amount,
          tx_hash: it.txHash, op_id: it.id, kind: it.type, ledger_at: it.createdAt,
        });
        if (!error) {
          indexed++;
          if (it.direction === "in") {
            const seen = await db().from("notifications").select("id").eq("profile_id", w.profile_id).eq("entity_id", it.txHash).maybeSingle();
            if (!seen.data) await db().from("notifications").insert({ profile_id: w.profile_id, type: "payment", entity_type: "tx", entity_id: it.txHash, body: `You received ${it.amount} ${it.asset}` });
          }
        }
      }
      await db().from("sync_cursors").upsert({ key, cursor: page.items[0]?.id ?? "0", updated_at: new Date().toISOString() });
    } catch (e) {
      console.error("[reconcile] payments", w.address, (e as Error).message);
    }
  }
  report.transfersIndexed = indexed;
  return ok(report);
});
