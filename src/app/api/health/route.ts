import { NextRequest } from "next/server";
import { optionalUser } from "@/lib/server/auth";
import { env } from "@/lib/server/env";
import { escrowContractId } from "@/lib/server/escrow";
import { ok, route } from "@/lib/server/http";
import { paiflow, workflowId } from "@/lib/server/paiflow";
import { db } from "@/lib/server/supabase";
import { horizon, network, sorobanRpc } from "@/lib/stellar/network";
import { simulateRead } from "@/lib/stellar/tx";

/**
 * Configuration self-test used by START_HERE.md. Reports only booleans and
 * error messages, never secret values. Deep checks run in development, for
 * admins, or with the CRON_SECRET bearer.
 */
export const GET = route(async (req: NextRequest) => {
  const e = env();
  const present = {
    supabase: !!(e.NEXT_PUBLIC_SUPABASE_URL && e.NEXT_PUBLIC_SUPABASE_ANON_KEY && e.SUPABASE_SERVICE_ROLE_KEY),
    supabaseRealtimeJwt: !!e.SUPABASE_JWT_SECRET,
    privy: !!(e.NEXT_PUBLIC_PRIVY_APP_ID && e.PRIVY_APP_SECRET),
    escrowContract: !!e.SOROBAN_JOB_ESCROW_CONTRACT_ID,
    faucetTreasury: !!e.FAUCET_TREASURY_SECRET,
    feeCollector: !!e.FEE_COLLECTOR_ADDRESS,
    paiflowApi: !!e.PAIFLOW_API_KEY,
    paiflowWorkflows: { FEES_USDC: !!workflowId("FEES_USDC"), FEES_XLM: !!workflowId("FEES_XLM") },
    earnEnabled: e.USDC_AUTO_EARN_ENABLED,
    cronSecret: !!e.CRON_SECRET,
  };
  const user = await optionalUser(req).catch(() => null);
  const deep = process.env.NODE_ENV === "development" || user?.profile.role === "admin" || (!!e.CRON_SECRET && req.headers.get("authorization") === `Bearer ${e.CRON_SECRET}`);
  if (!deep) return ok({ network: e.STELLAR_NETWORK, present });

  const checks: Record<string, string> = {};
  const run = async (name: string, fn: () => Promise<unknown>) => {
    try {
      await fn();
      checks[name] = "ok";
    } catch (err) {
      checks[name] = (err as Error).message.slice(0, 200);
    }
  };
  await run("network", async () => network());
  await run("supabase", async () => {
    const r = await db().from("profiles").select("id", { head: true, count: "exact" });
    if (r.error) throw new Error(r.error.message);
  });
  await run("horizon", () => horizon().feeStats());
  await run("sorobanRpc", () => sorobanRpc().getHealth());
  if (present.escrowContract) await run("escrowContract", () => simulateRead(escrowContractId(), "get_config", []));
  if (present.paiflowApi) {
    const pf = paiflow()!;
    for (const k of ["FEES_USDC", "FEES_XLM"] as const) {
      const id = workflowId(k);
      if (id) await run(`paiflow_${k}`, () => pf.capabilities(id));
    }
  }
  return ok({ network: e.STELLAR_NETWORK, present, checks });
});
