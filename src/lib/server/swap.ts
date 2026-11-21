import "server-only";
import { Asset } from "@stellar/stellar-sdk";
import { bad } from "./http";
import { getBalances } from "@/lib/stellar/account";
import { formatAmount, fromStroops, toStroops } from "@/lib/stellar/amount";
import { asset, horizon, type AssetCode } from "@/lib/stellar/network";

/** If the price moves more than this between the quote and the swap, the swap is cancelled and nothing moves. */
export const SWAP_SLIPPAGE_BPS = 100; // 1%
const MIN_SEND: Record<AssetCode, string> = { XLM: "1", USDC: "0.1" };

export type SwapQuote = {
  from: AssetCode; to: AssetCode;
  send: bigint; receive: bigint; minReceive: bigint;
  /** How many `to` you get for 1 `from`, for display. */
  rate: string;
  path: Asset[];
};

export const other = (c: AssetCode): AssetCode => (c === "XLM" ? "USDC" : "XLM");

/**
 * Best price right now on Stellar's built-in exchange for swapping between
 * XLM and USDC. Throws a plain message when the swap can't be done.
 */
export async function quoteSwap(from: AssetCode, amount: string): Promise<SwapQuote> {
  let send: bigint;
  try { send = toStroops(amount); } catch { throw bad("Enter an amount, for example 10."); }
  if (send < toStroops(MIN_SEND[from])) throw bad(`The smallest swap is ${MIN_SEND[from]} ${from}.`);
  const to = other(from);
  const page = await horizon().strictSendPaths(asset(from), fromStroops(send), [asset(to)]).call().catch(() => null);
  const best = (page?.records ?? [])
    .map((r) => ({ receive: toStroops(r.destination_amount), path: r.path }))
    .sort((a, b) => (a.receive > b.receive ? -1 : a.receive < b.receive ? 1 : 0))[0];
  if (!best || best.receive <= 0n) throw bad(`Nobody is offering ${to} for ${from} right now. Try a smaller amount, or try again later.`);
  const minReceive = (best.receive * BigInt(10_000 - SWAP_SLIPPAGE_BPS)) / 10_000n;
  const path = best.path.map((p) => (p.asset_type === "native" ? Asset.native() : new Asset(p.asset_code!, p.asset_issuer!)));
  const rate = formatAmount((best.receive * 10_000_000n) / send, 4);
  return { from, to, send, receive: best.receive, minReceive, rate, path };
}

/** Can this wallet make the swap? Throws a plain message if not. */
export async function assertCanSwap(address: string, q: SwapQuote) {
  const b = await getBalances(address);
  if (!b.exists) throw bad("Your wallet isn't active yet. Add some test money first.");
  if (q.to === "USDC" && b.usdc === null) throw bad("Turn on USDC in your wallet first, then swap.");
  if (q.from === "XLM") {
    // Keep enough XLM for the network fee; the locked reserve is already excluded from "available".
    const spendable = toStroops(b.xlmAvailable) - toStroops("0.01");
    if (q.send > spendable) throw bad(`You can swap up to ${formatAmount(spendable > 0n ? spendable : 0n, 2)} XLM. A little XLM always stays in your wallet.`);
  } else if (q.send > toStroops(b.usdc ?? "0")) {
    throw bad(`You only have ${formatAmount(toStroops(b.usdc ?? "0"), 2)} USDC.`);
  }
}
