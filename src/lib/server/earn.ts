import "server-only";
import { nativeToScVal, scValToNative, xdr } from "@stellar/stellar-sdk";
import { fromStroops } from "@/lib/stellar/amount";
import { assetContractId, network } from "@/lib/stellar/network";
import { buildContractCallTx, scAddress, simulateRead } from "@/lib/stellar/tx";
import { env } from "./env";
import { db } from "./supabase";

const SCALAR_12 = 1_000_000_000_000n;
const REQUEST_SUPPLY = 0; // Blend v2 RequestType::Supply (non-collateral)
const REQUEST_WITHDRAW = 1; // Blend v2 RequestType::Withdraw

export type EarnConfig = {
  enabled: boolean;
  experimental: boolean;
  reason: string | null;
  poolId: string | null;
  assetContract: string | null;
  assetIsCircleUsdc: boolean;
  targetAprDisplay: number;
  /** "vault": pooled Senda vault contract (experimental). "direct": user supplies to Blend from own wallet. */
  mode: "vault" | "direct";
  vaultId: string | null;
};

/**
 * Earn is OFF unless USDC_AUTO_EARN_ENABLED=true AND a Blend pool is configured.
 * On testnet it is always labelled experimental. On mainnet it also requires
 * the asset to be the configured real USDC.
 */
export function earnConfig(): EarnConfig {
  const e = env();
  const poolId = e.SOROBAN_YIELD_STRATEGY_CONTRACT_ID ?? null;
  let usdc: string | null = null;
  try {
    usdc = assetContractId("USDC");
  } catch {
    usdc = null;
  }
  const assetContract = e.EARN_ASSET_CONTRACT_ID ?? usdc;
  const testnet = network().isTestnet;
  let reason: string | null = null;
  if (!e.USDC_AUTO_EARN_ENABLED) reason = "USDC Auto Earn is turned off. No yield source has been approved for this deployment.";
  else if (!poolId) reason = "No audited lending pool is configured (SOROBAN_YIELD_STRATEGY_CONTRACT_ID).";
  else if (!testnet && assetContract !== usdc) reason = "On mainnet the earn asset must be the configured USDC.";
  const vaultId = e.SOROBAN_USDC_EARN_VAULT_CONTRACT_ID ?? null;
  // The vault is unaudited: it may only run on testnet until an audit is signed off.
  if (!reason && vaultId && !testnet && !e.EARN_VAULT_AUDITED) reason = "The Earn vault has not passed an independent audit, so it is disabled on mainnet.";
  return {
    enabled: !reason,
    experimental: testnet,
    reason,
    poolId,
    assetContract,
    assetIsCircleUsdc: assetContract === usdc,
    targetAprDisplay: e.USDC_TARGET_APR_DISPLAY,
    mode: vaultId ? "vault" : "direct",
    vaultId,
  };
}

type Reserve = { index: number; bRate: bigint; supplyCap: bigint; enabled: boolean; decimals: number; bSupply: bigint; dSupply: bigint; dRate: bigint };

export async function readReserve(poolId: string, assetContract: string): Promise<Reserve> {
  const v = await simulateRead(poolId, "get_reserve", [scAddress(assetContract)]);
  const r = scValToNative(v!) as { config: Record<string, unknown>; data: Record<string, unknown> };
  return {
    index: Number(r.config.index),
    decimals: Number(r.config.decimals),
    enabled: Boolean(r.config.enabled),
    supplyCap: BigInt(r.config.supply_cap as bigint),
    bRate: BigInt(r.data.b_rate as bigint),
    dRate: BigInt(r.data.d_rate as bigint),
    bSupply: BigInt(r.data.b_supply as bigint),
    dSupply: BigInt(r.data.d_supply as bigint),
  };
}

export async function readPosition(poolId: string, user: string, reserveIndex: number) {
  const v = await simulateRead(poolId, "get_positions", [scAddress(user)]);
  const p = scValToNative(v!) as { supply: Map<number, bigint> | Record<string, bigint>; collateral: Map<number, bigint> | Record<string, bigint> };
  const get = (m: Map<number, bigint> | Record<string, bigint>) =>
    m instanceof Map ? BigInt(m.get(reserveIndex) ?? 0n) : BigInt((m as Record<string, bigint>)[String(reserveIndex)] ?? 0n);
  return { supplyB: get(p.supply), collateralB: get(p.collateral) };
}

/** Stores a b_rate observation at most once an hour per pool/asset. */
export async function snapshotRate(poolId: string, assetContract: string, bRate: bigint) {
  const { data } = await db().from("earn_rate_snapshots").select("taken_at").eq("pool_id", poolId).eq("asset_contract", assetContract).order("taken_at", { ascending: false }).limit(1).maybeSingle();
  if (data && Date.now() - new Date(data.taken_at).getTime() < 3_600_000) return;
  await db().from("earn_rate_snapshots").insert({ pool_id: poolId, asset_contract: assetContract, b_rate: bRate.toString() });
}

/**
 * Realized supply APY measured from on-chain b_rate growth between a stored
 * snapshot (>= 24h old, up to 30 days) and now. Returns null until enough
 * history exists. This is what depositors actually earned, not a promise.
 */
export async function measuredApy(poolId: string, assetContract: string, nowRate: bigint) {
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const before = new Date(Date.now() - 86_400_000).toISOString();
  const { data } = await db().from("earn_rate_snapshots").select("b_rate, taken_at").eq("pool_id", poolId).eq("asset_contract", assetContract).gte("taken_at", since).lte("taken_at", before).order("taken_at", { ascending: true }).limit(1).maybeSingle();
  if (!data) return null;
  const then = BigInt(data.b_rate);
  const dtYears = (Date.now() - new Date(data.taken_at).getTime()) / (365 * 86_400_000);
  if (then <= 0n || dtYears <= 0) return null;
  const growth = Number((nowRate * 1_000_000_000n) / then) / 1e9;
  return { apy: Math.pow(growth, 1 / dtYears) - 1, windowDays: dtYears * 365, since: data.taken_at as string };
}

export async function earnOverview(user: string | null, profileId: string | null) {
  const cfg = earnConfig();
  if (!cfg.poolId || !cfg.assetContract) return { config: cfg, reserve: null, position: null, measured: null };
  const reserve = await readReserve(cfg.poolId, cfg.assetContract);
  await snapshotRate(cfg.poolId, cfg.assetContract, reserve.bRate).catch(() => null);
  const measured = await measuredApy(cfg.poolId, cfg.assetContract, reserve.bRate);
  let position = null;
  if (user && cfg.mode === "vault" && cfg.vaultId) {
    const v = await readVaultPosition(cfg.vaultId, user);
    position = { bTokens: v.shares.toString(), value: fromStroops(v.value), netDeposited: fromStroops(v.netDeposits), shares: v.shares.toString() };
  } else if (user) {
    const pos = await readPosition(cfg.poolId, user, reserve.index);
    const value = ((pos.supplyB + pos.collateralB) * reserve.bRate) / SCALAR_12;
    let netDeposited = "0";
    if (profileId) {
      const { data } = await db().from("earn_positions").select("net_deposited").eq("profile_id", profileId).eq("pool_id", cfg.poolId).eq("asset_contract", cfg.assetContract).maybeSingle();
      netDeposited = data?.net_deposited ?? "0";
    }
    position = { bTokens: (pos.supplyB + pos.collateralB).toString(), value: fromStroops(value), netDeposited: String(netDeposited) };
  }
  const utilization = reserve.bSupply > 0n ? Number(((reserve.dSupply * reserve.dRate) / SCALAR_12) * 10_000n / ((reserve.bSupply * reserve.bRate) / SCALAR_12)) / 10_000 : 0;
  return {
    config: cfg,
    reserve: { index: reserve.index, bRate: reserve.bRate.toString(), enabled: reserve.enabled, utilization, totalSupplied: fromStroops((reserve.bSupply * reserve.bRate) / SCALAR_12) },
    position,
    measured,
  };
}

function requestVec(assetContract: string, amount: bigint, type: number) {
  // Blend Request { request_type: u32, address: Address, amount: i128 } as a
  // contracttype struct => ScMap with keys sorted alphabetically.
  const entry = (k: string, v: xdr.ScVal) => new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol(k), val: v });
  const req = xdr.ScVal.scvMap([
    entry("address", scAddress(assetContract)),
    entry("amount", nativeToScVal(amount, { type: "i128" })),
    entry("request_type", nativeToScVal(type, { type: "u32" })),
  ]);
  return xdr.ScVal.scvVec([req]);
}

/** User supplies from their own wallet directly into the Blend pool (non-custodial). */
export function buildSupplyTx(user: string, poolId: string, assetContract: string, amount: bigint) {
  return buildContractCallTx(user, poolId, "submit", [scAddress(user), scAddress(user), scAddress(user), requestVec(assetContract, amount, REQUEST_SUPPLY)]);
}

export function buildWithdrawTx(user: string, poolId: string, assetContract: string, amount: bigint) {
  return buildContractCallTx(user, poolId, "submit", [scAddress(user), scAddress(user), scAddress(user), requestVec(assetContract, amount, REQUEST_WITHDRAW)]);
}

// ───────────────────────── Senda Earn vault (experimental) ─────────────────────────

const big = (v: unknown) => BigInt((v as bigint | number | undefined) ?? 0);

/** Confirms the deployed vault is wired to the configured pool and asset before anyone uses it. */
export async function assertVaultWiring(vaultId: string, poolId: string, assetContract: string) {
  const v = await simulateRead(vaultId, "config", []);
  const c = scValToNative(v!) as { asset: string; strategy: string; paused: boolean };
  if (String(c.strategy) !== poolId || String(c.asset) !== assetContract) {
    throw new Error("Earn vault is not configured for this pool/asset. Check SOROBAN_USDC_EARN_VAULT_CONTRACT_ID.");
  }
  return { paused: Boolean(c.paused) };
}

export async function readVaultPosition(vaultId: string, user: string) {
  const [shares, value, nd, ts, ta] = await Promise.all([
    simulateRead(vaultId, "shares", [scAddress(user)]),
    simulateRead(vaultId, "value_of", [scAddress(user)]),
    simulateRead(vaultId, "net_deposits", [scAddress(user)]),
    simulateRead(vaultId, "total_shares", []),
    simulateRead(vaultId, "total_assets", []),
  ]);
  return {
    shares: big(scValToNative(shares!)),
    value: big(scValToNative(value!)),
    netDeposits: big(scValToNative(nd!)),
    totalShares: big(scValToNative(ts!)),
    totalAssets: big(scValToNative(ta!)),
  };
}

const VIRTUAL_SHARES = 1_000n; // must match contracts/usdc_earn_vault

/** Shares to burn to receive about `amount` (rounded up, capped at what the user owns). */
export function sharesForAmount(amount: bigint, totalShares: bigint, totalAssets: bigint, owned: bigint) {
  const s = (amount * (totalShares + VIRTUAL_SHARES) + totalAssets) / (totalAssets + 1n);
  return s > owned ? owned : s;
}

export function buildVaultDepositTx(user: string, vaultId: string, amount: bigint) {
  return buildContractCallTx(user, vaultId, "deposit", [scAddress(user), nativeToScVal(amount, { type: "i128" })]);
}

export function buildVaultWithdrawTx(user: string, vaultId: string, shares: bigint) {
  return buildContractCallTx(user, vaultId, "withdraw", [scAddress(user), nativeToScVal(shares, { type: "i128" })]);
}
