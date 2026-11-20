import { NextRequest } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/server/auth";
import { claim, faucetStatus } from "@/lib/server/faucet";
import { audit, body, ipHash, ok, rateLimit, route } from "@/lib/server/http";
import { txLink } from "@/lib/stellar/network";

export const GET = route(async (req: NextRequest) => ok(await faucetStatus(await requireUser(req))));

const Body = z.object({ kind: z.enum(["signup", "repeat"]), asset: z.enum(["XLM", "USDC"]) });

export const POST = route(async (req: NextRequest) => {
  const c = await requireUser(req);
  const ip = ipHash(req);
  await rateLimit(`faucet:${c.profile.id}`, 6, 3600);
  await rateLimit(`faucet-ip:${ip}`, 20, 3600);
  const b = await body(req, Body);
  const r = await claim(c, b.kind, b.asset, ip);
  await audit(c.profile.id, "faucet.claim", "faucet", null, { ...b, status: r.status, hash: r.hash }, ip);
  return ok({ ...r, explorerUrl: r.hash ? txLink(r.hash) : null, status_: await faucetStatus(c) });
});
