import { NextRequest } from "next/server";
import { requireRole, requireUser } from "@/lib/server/auth";
import { env } from "@/lib/server/env";
import { ok, route } from "@/lib/server/http";
import { db, PUBLIC_PROFILE_FIELDS } from "@/lib/server/supabase";
import { getBalances } from "@/lib/stellar/account";

export const GET = route(async (req: NextRequest) => {
  const c = await requireUser(req);
  requireRole(c, "admin", "mediator");
  const since = new Date(Date.now() - 86_400_000).toISOString();
  const [reports, disputes, faucet, runs] = await Promise.all([
    db().from("moderation_reports").select(`*, reporter:profiles!moderation_reports_reporter_id_fkey(${PUBLIC_PROFILE_FIELDS})`).eq("status", "open").order("created_at", { ascending: false }).limit(50),
    db().from("jobs").select("id, title, asset, agreed_amount, updated_at").eq("status", "DISPUTED").order("updated_at", { ascending: false }).limit(50),
    db().from("faucet_claims").select("asset, amount, status").gte("created_at", since),
    db().from("workflow_runs").select("workflow_key, provider, status, tx_hash, created_at").order("created_at", { ascending: false }).limit(30),
  ]);
  const e = env();
  const totals: Record<string, number> = {};
  for (const f of (faucet.data ?? []) as { asset: string; amount: string; status: string }[]) if (f.status !== "failed") totals[f.asset] = (totals[f.asset] ?? 0) + Number(f.amount);
  let treasury = null;
  if (e.TREASURY_PUBLIC_ADDRESS) treasury = await getBalances(e.TREASURY_PUBLIC_ADDRESS).catch(() => null);
  let feeWallet = null;
  if (e.FEE_COLLECTOR_ADDRESS) feeWallet = await getBalances(e.FEE_COLLECTOR_ADDRESS).catch(() => null);
  return ok({
    reports: reports.data ?? [], disputes: disputes.data ?? [], faucetToday: totals, faucetCap: e.FAUCET_DAILY_TREASURY_CAP,
    workflowRuns: runs.data ?? [], treasury, feeWallet, feeCollector: e.FEE_COLLECTOR_ADDRESS ?? null, isFeeCollector: !!c.wallet && c.wallet === e.FEE_COLLECTOR_ADDRESS,
  });
});
