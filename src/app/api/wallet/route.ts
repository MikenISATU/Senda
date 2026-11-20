import { NextRequest } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { ok, route } from "@/lib/server/http";
import { getBalances } from "@/lib/stellar/account";
import { network } from "@/lib/stellar/network";

export const GET = route(async (req: NextRequest) => {
  const c = await requireUser(req);
  if (!c.wallet) return ok({ address: null, balances: null });
  const balances = await getBalances(c.wallet);
  const n = network();
  return ok({ address: c.wallet, balances, network: n.name, explorer: `${n.explorer}/account/${c.wallet}`, usdcIssuer: n.usdcIssuer });
});
