import "server-only";
import { getBalances } from "@/lib/stellar/account";
import { splitFee } from "@/lib/stellar/amount";
import { asset, type AssetCode } from "@/lib/stellar/network";
import { buildPaymentTx, type PaymentLeg } from "@/lib/stellar/tx";
import { env } from "./env";
import { bad } from "./http";

/**
 * Creator payout + platform fee in ONE atomic Stellar transaction (both legs
 * succeed or neither does). This is the TIP / POST_PURCHASE split. Paiflow
 * Split flows have fixed recipients, so a per-creator split is done here.
 */
export async function buildSplitPayment(from: string, creator: string, code: AssetCode, gross: bigint, memo?: string) {
  const e = env();
  const collector = e.FEE_COLLECTOR_ADDRESS && e.FEE_COLLECTOR_ADDRESS !== creator && e.FEE_COLLECTOR_ADDRESS !== from ? e.FEE_COLLECTOR_ADDRESS : null;
  const { net, fee } = collector ? splitFee(gross, e.PLATFORM_FEE_BPS) : { net: gross, fee: 0n };
  const dest = await getBalances(creator);
  if (!dest.exists) throw bad("The creator's wallet is not activated yet.");
  if (code === "USDC" && dest.usdc === null) throw bad("The creator hasn't enabled USDC yet.");
  const legs: PaymentLeg[] = [{ destination: creator, asset: asset(code), stroops: net }];
  if (collector && fee > 0n) {
    const fc = await getBalances(collector);
    if (!fc.exists || (code === "USDC" && fc.usdc === null)) throw bad("Platform fee wallet cannot receive this asset yet. Contact support.");
    legs.push({ destination: collector, asset: asset(code), stroops: fee });
  }
  const tx = await buildPaymentTx(from, legs, memo);
  return { tx, net, fee, collector };
}
