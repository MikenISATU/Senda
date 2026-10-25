import { NextRequest } from "next/server";
import { requireUser, requireWallet } from "@/lib/server/auth";
import { ok, rateLimit, route } from "@/lib/server/http";
import { createIntent } from "@/lib/server/intents";
import { asset, network } from "@/lib/stellar/network";
import { buildChangeTrustTx } from "@/lib/stellar/tx";

/** Adds the USDC trustline (the user's account opts in to hold the verified USDC issuer). */
export const POST = route(async (req: NextRequest) => {
  const c = await requireUser(req);
  const from = requireWallet(c);
  await rateLimit(`trust:${c.profile.id}`, 10, 60);
  const usdc = asset("USDC");
  const issuer = usdc.getIssuer() ?? "";
  const tx = await buildChangeTrustTx(from, usdc);
  return ok(
    await createIntent({
      caller: c,
      kind: "trustline",
      provider: "stellar",
      tx,
      payload: { asset: "USDC", issuer },
      summary: {
        title: "Enable USDC",
        lines: [
          { label: "Asset", value: "USDC" },
          { label: "Issuer", value: `${issuer.slice(0, 6)}...${issuer.slice(-6)} (${network().isTestnet ? "Circle testnet" : "configured issuer"})` },
          { label: "Reserve", value: "Locks 0.5 XLM while enabled" },
        ],
      },
    }),
  );
});
