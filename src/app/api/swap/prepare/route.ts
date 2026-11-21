import { NextRequest } from "next/server";
import { z } from "zod";
import { requireUser, requireWallet } from "@/lib/server/auth";
import { body, ok, rateLimit, route } from "@/lib/server/http";
import { createIntent } from "@/lib/server/intents";
import { assertCanSwap, quoteSwap, SWAP_SLIPPAGE_BPS } from "@/lib/server/swap";
import { formatAmount } from "@/lib/stellar/amount";
import { asset } from "@/lib/stellar/network";
import { buildSwapTx } from "@/lib/stellar/tx";

/**
 * Swap XLM for USDC or USDC for XLM inside the user's own wallet. The price
 * is fetched fresh here, and the transaction itself refuses to complete if
 * the user would get less than the "at least" amount shown, so nothing can
 * move at a worse price than the one they approved. Senda takes no fee.
 */
export const POST = route(async (req: NextRequest) => {
  const c = await requireUser(req);
  const from = requireWallet(c);
  await rateLimit(`swap:${c.profile.id}`, 20, 60);
  const b = await body(req, z.object({ from: z.enum(["XLM", "USDC"]), amount: z.string().trim().max(24), idempotencyKey: z.string().max(80).optional() }));
  const q = await quoteSwap(b.from, b.amount);
  await assertCanSwap(from, q);
  const tx = await buildSwapTx(from, { send: asset(q.from), sendStroops: q.send, receive: asset(q.to), minReceiveStroops: q.minReceive, path: q.path });
  return ok(
    await createIntent({
      caller: c,
      kind: "payment", // a payment to yourself: no recipient, so no extra records are created
      provider: "stellar",
      tx,
      idempotencyKey: b.idempotencyKey,
      payload: { swap: true, from: q.from, to: q.to, send: formatAmount(q.send, 7), receive: formatAmount(q.receive, 7), minReceive: formatAmount(q.minReceive, 7) },
      summary: {
        title: `Swap ${formatAmount(q.send, 7)} ${q.from} for ${q.to}`,
        lines: [
          { label: "You pay", value: `${formatAmount(q.send, 7)} ${q.from}` },
          { label: "You get about", value: `${formatAmount(q.receive, 4)} ${q.to}` },
          { label: "At least", value: `${formatAmount(q.minReceive, 4)} ${q.to}` },
          { label: "Price", value: `1 ${q.from} = ${q.rate} ${q.to}` },
          { label: "Senda fee", value: "None" },
          { label: "If the price drops", value: `More than ${SWAP_SLIPPAGE_BPS / 100}% and the swap is cancelled. Nothing moves.` },
        ],
      },
    }),
  );
});
