import { NextRequest } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/server/auth";
import { env } from "@/lib/server/env";
import { audit, body, conflict, forbidden, ok, rateLimit, route } from "@/lib/server/http";
import { getPrivyIdentity } from "@/lib/server/privy";
import { db, must } from "@/lib/server/supabase";

const Body = z.object({ address: z.string().regex(/^G[A-Z2-7]{55}$/, "Invalid Stellar address") });

/**
 * Links the user's Privy-provisioned Stellar wallet. Ownership is proven by
 * re-fetching the user from Privy's API server-side; a client-claimed address
 * that is not one of the user's Privy embedded wallets is rejected.
 */
export const POST = route(async (req: NextRequest) => {
  const caller = await requireUser(req);
  await rateLimit(`wallet-register:${caller.profile.id}`, 10, 60);
  const { address } = await body(req, Body);
  if (caller.wallet === address) return ok({ address });
  if (caller.wallet) throw conflict("A different wallet is already linked to this account.");
  const identity = await getPrivyIdentity(caller.privyUserId);
  const match = identity.stellarWallets.find((w) => w.address === address);
  if (!match) throw forbidden("That address is not a Stellar wallet owned by your Privy account.");
  must(
    await db().from("linked_wallets").insert({
      profile_id: caller.profile.id, address, network: env().STELLAR_NETWORK, privy_wallet_id: match.walletId, is_primary: true,
    }),
  );
  await audit(caller.profile.id, "wallet.linked", "wallet", address);
  return ok({ address });
});
