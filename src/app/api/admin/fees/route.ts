import { NextRequest } from "next/server";
import { z } from "zod";
import { requireRole, requireUser, requireWallet } from "@/lib/server/auth";
import { bad, body, ok, rateLimit, route } from "@/lib/server/http";
import { buildDistributeTx, splitterOverview } from "@/lib/server/fees";
import { createIntent } from "@/lib/server/intents";

const Body = z.object({ asset: z.enum(["XLM", "USDC"]) });

/**
 * Sends job fees waiting in the fee contract to the treasury and community
 * wallets. The contract lets anyone do this; the admin just pays the network fee.
 */
export const POST = route(async (req: NextRequest) => {
  const c = await requireUser(req);
  requireRole(c, "admin");
  const from = requireWallet(c);
  await rateLimit(`distribute:${c.profile.id}`, 10, 60);
  const b = await body(req, Body);
  const o = await splitterOverview();
  if (!o) throw bad("The fee contract is not configured.");
  const waiting = o.tokens.find((t) => t.code === b.asset)?.waiting ?? "0";
  if (Number(waiting) <= 0) throw bad(`No ${b.asset} fees are waiting.`);
  const tx = await buildDistributeTx(from, b.asset);
  return ok(
    await createIntent({
      caller: c,
      kind: "fee_distribute",
      provider: "soroban",
      tx,
      payload: { asset: b.asset, amount: waiting },
      summary: {
        title: `Distribute ${waiting} ${b.asset} in fees`,
        lines: o.config.shares.map((s) => ({ label: `${s.to.slice(0, 6)}...${s.to.slice(-6)}`, value: `${s.bps / 100}%` })),
      },
    }),
  );
});
