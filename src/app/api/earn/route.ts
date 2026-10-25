import { NextRequest } from "next/server";
import { z } from "zod";
import { optionalUser, requireUser, requireWallet } from "@/lib/server/auth";
import { assertVaultWiring, buildSupplyTx, buildVaultDepositTx, buildVaultWithdrawTx, buildWithdrawTx, earnConfig, earnOverview, readVaultPosition, sharesForAmount } from "@/lib/server/earn";
import { bad, body, ok, rateLimit, route } from "@/lib/server/http";
import { createIntent } from "@/lib/server/intents";
import { db } from "@/lib/server/supabase";
import { formatAmount, toStroops } from "@/lib/stellar/amount";

export const GET = route(async (req: NextRequest) => {
  const c = await optionalUser(req);
  try {
    return ok(await earnOverview(c?.wallet ?? null, c?.profile.id ?? null));
  } catch (e) {
    return ok({ config: earnConfig(), reserve: null, position: null, measured: null, error: "Could not read the lending pool right now." });
  }
});

const Body = z.object({ action: z.enum(["supply", "withdraw"]), amount: z.string(), max: z.boolean().optional(), acceptRisks: z.literal(true) });

/**
 * Opt-in only. Funds go from the user's own wallet directly into the
 * configured audited Blend pool; Senda never holds them. Yield (if any) is
 * whatever the pool pays; there is no guaranteed rate.
 */
export const POST = route(async (req: NextRequest) => {
  const c = await requireUser(req);
  const user = requireWallet(c);
  await rateLimit(`earn:${c.profile.id}`, 10, 60);
  const cfg = earnConfig();
  if (!cfg.enabled || !cfg.poolId || !cfg.assetContract) throw bad(cfg.reason ?? "Earn is not available.");
  const b = await body(req, Body);
  const amount = toStroops(b.amount);
  if (amount < 10_000_000n && !(b.action === "withdraw" && b.max)) throw bad("Minimum is 1.");
  let tx;
  let sharesNote: { label: string; value: string }[] = [];
  if (cfg.mode === "vault" && cfg.vaultId) {
    const { paused } = await assertVaultWiring(cfg.vaultId, cfg.poolId, cfg.assetContract);
    if (b.action === "supply") {
      if (paused) throw bad("The Earn vault is paused for new deposits. Withdrawals still work.");
      tx = await buildVaultDepositTx(user, cfg.vaultId, amount);
    } else {
      const pos = await readVaultPosition(cfg.vaultId, user);
      if (pos.shares <= 0n) throw bad("You have nothing in the vault.");
      const shares = b.max ? pos.shares : sharesForAmount(amount, pos.totalShares, pos.totalAssets, pos.shares);
      tx = await buildVaultWithdrawTx(user, cfg.vaultId, shares);
      sharesNote = [{ label: "Vault shares burned", value: shares.toString() }];
    }
  } else {
    tx = b.action === "supply" ? await buildSupplyTx(user, cfg.poolId, cfg.assetContract, amount) : await buildWithdrawTx(user, cfg.poolId, cfg.assetContract, amount);
  }
  await db().from("earn_positions").upsert({ profile_id: c.profile.id, pool_id: cfg.poolId, asset_contract: cfg.assetContract }, { onConflict: "profile_id,pool_id,asset_contract", ignoreDuplicates: true });
  return ok(
    await createIntent({
      caller: c, kind: b.action === "supply" ? "earn_supply" : "earn_withdraw", provider: "soroban", tx,
      payload: { poolId: cfg.poolId, assetContract: cfg.assetContract, amount: b.amount, mode: cfg.mode },
      summary: {
        title: b.action === "supply" ? `Deposit ${formatAmount(amount, 7)} into lending pool` : `Withdraw ${formatAmount(amount, 7)} from lending pool`,
        lines: [
          ...(cfg.mode === "vault"
            ? [
                { label: "Vault", value: `Senda Earn vault ${cfg.vaultId!.slice(0, 6)}...${cfg.vaultId!.slice(-6)} (unaudited, testnet)` },
                { label: "Strategy", value: `Blend v2 pool ${cfg.poolId.slice(0, 6)}...${cfg.poolId.slice(-6)}` },
                { label: "Custody", value: "Held by the vault contract; only you can withdraw your shares" },
                ...sharesNote,
              ]
            : [
                { label: "Pool", value: `Blend v2 ${cfg.poolId.slice(0, 6)}...${cfg.poolId.slice(-6)}` },
                { label: "Custody", value: "Your wallet's own position; Senda cannot move it" },
              ]),
          { label: "Yield", value: "Variable, set by pool borrowers. Not guaranteed. Can be zero; losses possible." },
          ...(cfg.experimental ? [{ label: "Mode", value: "Testnet experiment" }] : []),
        ],
      },
    }),
  );
});
