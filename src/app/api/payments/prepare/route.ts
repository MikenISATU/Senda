import { NextRequest } from "next/server";
import { z } from "zod";
import { requireUser, requireWallet } from "@/lib/server/auth";
import { body, ok, rateLimit, route } from "@/lib/server/http";
import { preparePayment } from "@/lib/server/payments";

const Body = z.object({
  to: z.string().min(3).max(60),
  asset: z.enum(["XLM", "USDC"]),
  amount: z.string(),
  memo: z.string().max(28).optional(),
  idempotencyKey: z.string().uuid().optional(),
});

/** SEND workflow: a direct Stellar payment (see lib/server/payments.ts). */
export const POST = route(async (req: NextRequest) => {
  const c = await requireUser(req);
  const from = requireWallet(c);
  await rateLimit(`pay:${c.profile.id}`, 20, 60);
  const b = await body(req, Body);
  return ok(await preparePayment(c, from, b));
});
