import "server-only";
import { Keypair, nativeToScVal, scValToNative } from "@stellar/stellar-sdk";
import { getBalances } from "@/lib/stellar/account";
import { formatAmount, fromStroops, splitFee, toStroops } from "@/lib/stellar/amount";
import { asset, assetContractId, network, type AssetCode } from "@/lib/stellar/network";
import { buildContractCallTx, buildPaymentTx, scAddress, simulateRead, submitSoroban, TxBuildError } from "@/lib/stellar/tx";
import { env } from "./env";
import { bad } from "./http";

/**
 * Senda's fee splitter contract (contracts/fee_splitter).
 *
 *   pay(from, to, token, amount, kind)   recipient + fee recipients paid in one step
 *   distribute(token)                    splits job fees the escrow sent to the contract
 *
 * Fee rates and recipients live on-chain; the server only reads them.
 */
export type PayKind = "send" | "tip" | "purchase";
const KIND_INDEX: Record<PayKind, number> = { send: 0, tip: 1, purchase: 2 };

export function splitterId(): string | null {
  return env().SOROBAN_FEE_SPLITTER_CONTRACT_ID ?? null;
}

export type FeeConfig = { admin: string; sendBps: number; platformBps: number; paused: boolean; shares: { to: string; bps: number }[] };
let cache: { at: number; id: string; value: FeeConfig } | null = null;

/** On-chain fee settings, cached for a minute. Null when no splitter is configured or it cannot be read. */
export async function feeConfig(fresh = false): Promise<FeeConfig | null> {
  const id = splitterId();
  if (!id) return null;
  if (!fresh && cache && cache.id === id && Date.now() - cache.at < 60_000) return cache.value;
  try {
    const [c, s] = await Promise.all([simulateRead(id, "get_config", []), simulateRead(id, "get_shares", [])]);
    if (!c || !s) return null;
    const cfg = scValToNative(c) as { admin: string; send_fee_bps: number; platform_fee_bps: number; paused: boolean };
    const shares = (scValToNative(s) as { to: string; bps: number }[]).map((x) => ({ to: String(x.to), bps: Number(x.bps) }));
    const value: FeeConfig = { admin: String(cfg.admin), sendBps: Number(cfg.send_fee_bps), platformBps: Number(cfg.platform_fee_bps), paused: !!cfg.paused, shares };
    cache = { at: Date.now(), id, value };
    return value;
  } catch (e) {
    console.error("[fees] cannot read fee splitter:", (e as Error).message);
    return cache?.id === id ? cache.value : null;
  }
}

export const pct = (bps: number) => `${(bps / 100).toFixed(2).replace(/\.?0+$/, "")}%`;

/**
 * Builds a payment of `gross` from `from` to `to`.
 *
 * Normal case: one call to the fee splitter's `pay`, which sends the recipient
 * their share and the fee to the treasury and community wallets in the same
 * transaction. Fallbacks, both fee-free plain payments: no splitter configured
 * (or paused), or the recipient's account does not exist yet and this XLM
 * payment creates it.
 */
export async function buildPay(a: { from: string; to: string; code: AssetCode; gross: bigint; kind: PayKind; memo?: string; allowCreate?: boolean }) {
  if (a.gross <= 0n) throw bad("Amount must be greater than zero.");
  const dest = await getBalances(a.to);
  let createIfMissing = false;
  if (!dest.exists) {
    if (!a.allowCreate) throw bad("That wallet is not activated yet.");
    if (a.code !== "XLM") throw bad("The recipient's account is not activated yet. Send at least 1 XLM first.");
    if (a.gross < 10_000_000n) throw bad("To activate a new account, send at least 1 XLM.");
    createIfMissing = true;
  } else if (a.code === "USDC" && dest.usdc === null) {
    throw bad("The recipient hasn't turned on USDC yet. Ask them to open their Senda wallet once.");
  }

  // Check the balance up front so the user gets a plain message, not a simulation error.
  const mine = await getBalances(a.from);
  const have = a.code === "USDC" ? mine.usdc : mine.xlmAvailable;
  if (!mine.exists || have === null || toStroops(have) < a.gross) throw bad(`You don't have enough ${a.code} for this.`);

  const id = splitterId();
  const cfg = createIfMissing ? null : await feeConfig();
  if (id && cfg && !cfg.paused) {
    const bps = a.kind === "send" ? cfg.sendBps : cfg.platformBps;
    const { net, fee } = splitFee(a.gross, bps);
    if (net <= 0n) throw bad("Amount is too small.");
    try {
      const tx = await buildContractCallTx(
        a.from,
        id,
        "pay",
        [scAddress(a.from), scAddress(a.to), scAddress(assetContractId(a.code)), nativeToScVal(a.gross, { type: "i128" }), nativeToScVal(KIND_INDEX[a.kind], { type: "u32" })],
      );
      return { tx, net, fee, bps, provider: "soroban" as const, createIfMissing };
    } catch (e) {
      if (e instanceof TxBuildError && e.code === "SIMULATION_FAILED") throw bad("This payment could not be prepared. Check your balance and try again.");
      throw e;
    }
  }
  const tx = await buildPaymentTx(a.from, [{ destination: a.to, asset: asset(a.code), stroops: a.gross, createIfMissing }], a.memo);
  return { tx, net: a.gross, fee: 0n, bps: 0, provider: "stellar" as const, createIfMissing };
}

/** Summary lines shared by send, tip and purchase review screens. */
export function feeLines(who: string, p: { net: bigint; fee: bigint; bps: number }, code: AssetCode) {
  if (p.fee <= 0n) return [];
  return [
    { label: `${who} receives`, value: `${formatAmount(p.net, 7)} ${code}` },
    { label: `Senda fee (${pct(p.bps)})`, value: `${formatAmount(p.fee, 7)} ${code}` },
  ];
}

export type SplitterOverview = {
  contractId: string;
  explorer: string;
  config: FeeConfig;
  tokens: { code: AssetCode; collected: string; waiting: string }[];
};

/** For the admin page: settings, lifetime fees, and job fees waiting to be distributed. */
export async function splitterOverview(): Promise<SplitterOverview | null> {
  const id = splitterId();
  const config = await feeConfig(true);
  if (!id || !config) return null;
  const tokens = await Promise.all(
    (["USDC", "XLM"] as AssetCode[]).map(async (code) => {
      const token = assetContractId(code);
      const [collected, waiting] = await Promise.all([
        simulateRead(id, "total_collected", [scAddress(token)]).then((v) => (v ? BigInt(scValToNative(v)) : 0n)).catch(() => 0n),
        simulateRead(token, "balance", [scAddress(id)]).then((v) => (v ? BigInt(scValToNative(v)) : 0n)).catch(() => 0n),
      ]);
      return { code, collected: fromStroops(collected), waiting: fromStroops(waiting) };
    }),
  );
  const n = network();
  return { contractId: id, explorer: `https://stellar.expert/explorer/${n.isTestnet ? "testnet" : "public"}/contract/${id}`, config, tokens };
}

export function buildDistributeTx(signer: string, code: AssetCode) {
  const id = splitterId();
  if (!id) throw bad("The fee contract is not configured.");
  return buildContractCallTx(signer, id, "distribute", [scAddress(assetContractId(code))]);
}

/**
 * Called by the reconciler. `distribute` is open to anyone, so on testnet the
 * faucet wallet pays the tiny network fee to push waiting job fees out to the
 * treasury and community wallets. Does nothing without that key.
 */
export async function autoDistribute(): Promise<Record<string, string>> {
  const e = env();
  const report: Record<string, string> = {};
  if (!splitterId() || e.STELLAR_NETWORK !== "testnet" || !e.FAUCET_TREASURY_SECRET) return report;
  const o = await splitterOverview();
  if (!o) return report;
  const kp = Keypair.fromSecret(e.FAUCET_TREASURY_SECRET);
  for (const t of o.tokens) {
    if (Number(t.waiting) <= 0) continue;
    try {
      const tx = await buildDistributeTx(kp.publicKey(), t.code);
      tx.sign(kp);
      const r = await submitSoroban(tx);
      report[t.code] = `${t.waiting} ${r.status}`;
    } catch (err) {
      report[t.code] = `error: ${(err as Error).message}`;
    }
  }
  return report;
}
