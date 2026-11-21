import { NextRequest } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { bad, ok, rateLimit, route } from "@/lib/server/http";
import { quoteSwap, SWAP_SLIPPAGE_BPS } from "@/lib/server/swap";
import { formatAmount } from "@/lib/stellar/amount";

/** Live price for swapping XLM and USDC. Read-only: nothing is prepared or moved. */
export const GET = route(async (req: NextRequest) => {
  const c = await requireUser(req);
  await rateLimit(`swapq:${c.profile.id}`, 60, 60);
  const from = req.nextUrl.searchParams.get("from");
  if (from !== "XLM" && from !== "USDC") throw bad("Choose XLM or USDC.");
  const q = await quoteSwap(from, req.nextUrl.searchParams.get("amount") ?? "");
  return ok({
    from: q.from, to: q.to,
    send: formatAmount(q.send, 7), receive: formatAmount(q.receive, 7), minReceive: formatAmount(q.minReceive, 7),
    rate: q.rate, slippagePercent: SWAP_SLIPPAGE_BPS / 100,
  });
});
