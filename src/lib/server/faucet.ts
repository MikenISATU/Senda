import "server-only";
import { randomUUID } from "node:crypto";
import { Keypair, TransactionBuilder, Account, Operation } from "@stellar/stellar-sdk";
import { getBalances } from "@/lib/stellar/account";
import { toSdkAmount, toStroops } from "@/lib/stellar/amount";
import { asset, horizon, network, type AssetCode } from "@/lib/stellar/network";
import { submitClassic } from "@/lib/stellar/tx";
import type { Caller } from "./auth";
import { env } from "./env";
import { HttpError } from "./http";
import { db, must } from "./supabase";

export type FaucetStatus = {
  enabled: boolean;
  reason?: string;
  network: string;
  accountExists: boolean;
  hasUsdcTrustline: boolean;
  signup: { xlm: boolean; usdc: boolean };
  nextRepeatAt: { XLM: string | null; USDC: string | null };
  amounts: { repeatXlm: number; repeatUsdc: number; signupUsdc: number };
  recent: { id: string; asset: string; amount: string; kind: string; status: string; tx_hash: string | null; created_at: string }[];
};

function treasury(): Keypair | null {
  const s = env().FAUCET_TREASURY_SECRET;
  if (!s) return null;
  const kp = Keypair.fromSecret(s);
  const pub = env().TREASURY_PUBLIC_ADDRESS;
  if (pub && pub !== kp.publicKey()) throw new HttpError(503, "Treasury secret does not match TREASURY_PUBLIC_ADDRESS", "NOT_CONFIGURED");
  return kp;
}

function disabledReason(): string | null {
  const e = env();
  if (!network().isTestnet) return "The faucet only exists on testnet. Mainnet funds are never given away.";
  if (!e.FAUCET_ENABLED) return "The faucet is turned off.";
  return null;
}

function cooldownMs() {
  return env().FAUCET_CLAIM_COOLDOWN_HOURS * 3600_000;
}

export async function faucetStatus(c: Caller): Promise<FaucetStatus> {
  const e = env();
  const reason = disabledReason();
  const bal = c.wallet ? await getBalances(c.wallet) : null;
  const rows = must(
    await db().from("faucet_claims").select("id, asset, amount, kind, status, tx_hash, created_at").eq("profile_id", c.profile.id).order("created_at", { ascending: false }).limit(20),
  ) as FaucetStatus["recent"];
  const ok = rows.filter((r) => r.status !== "failed");
  const next = (code: AssetCode) => {
    const last = ok.find((r) => r.kind === "repeat" && r.asset === code);
    if (!last) return null;
    // Windows are fixed (floor(now / cooldown)); next window starts at the boundary.
    const w = Math.floor(new Date(last.created_at).getTime() / cooldownMs());
    const at = (w + 1) * cooldownMs();
    return at > Date.now() ? new Date(at).toISOString() : null;
  };
  return {
    enabled: !reason,
    reason: reason ?? undefined,
    network: network().name,
    accountExists: !!bal?.exists,
    hasUsdcTrustline: bal?.usdc !== null && !!bal?.exists,
    signup: { xlm: ok.some((r) => r.kind === "signup" && r.asset === "XLM"), usdc: ok.some((r) => r.kind === "signup" && r.asset === "USDC") },
    nextRepeatAt: { XLM: next("XLM"), USDC: next("USDC") },
    amounts: { repeatXlm: e.FAUCET_XLM_CLAIM_AMOUNT, repeatUsdc: e.FAUCET_USDC_CLAIM_AMOUNT, signupUsdc: e.FAUCET_USDC_NEW_USER_AMOUNT },
    recent: rows,
  };
}

async function reserveSlot(c: Caller, key: string, kind: "signup" | "repeat", code: AssetCode, amount: number, ipHash: string) {
  const { data, error } = await db()
    .from("faucet_claims")
    .insert({ profile_id: c.profile.id, address: c.wallet, kind, asset: code, amount: amount.toFixed(7), idempotency_key: key, ip_hash: ipHash })
    .select("id")
    .single();
  if (error?.code === "23505") throw new HttpError(409, "You already claimed this. Check the next eligible time.", "ALREADY_CLAIMED");
  if (error) throw new Error(error.message);
  return data.id as string;
}

async function finish(id: string, r: { status: "confirmed" | "failed" | "pending"; hash?: string; error?: string }) {
  if (r.status === "failed") {
    // Free the idempotency slot so a definitive failure can be retried.
    await db().from("faucet_claims").update({ status: "failed", error: r.error ?? null, tx_hash: r.hash ?? null, idempotency_key: `failed:${id}:${randomUUID()}` }).eq("id", id);
  } else {
    await db().from("faucet_claims").update({ status: r.status === "confirmed" ? "confirmed" : "pending", tx_hash: r.hash ?? null }).eq("id", id);
  }
}

async function friendbot(address: string) {
  const res = await fetch(`https://friendbot.stellar.org/?addr=${encodeURIComponent(address)}`, { cache: "no-store", signal: AbortSignal.timeout(30_000) });
  const j = (await res.json().catch(() => ({}))) as { hash?: string; detail?: string };
  if (!res.ok) throw new HttpError(502, j.detail?.includes("createAccountAlreadyExist") ? "Account already exists." : "Friendbot is unavailable. Try again shortly.", "FRIENDBOT");
  return j.hash ?? null;
}

async function sendFromTreasury(to: string, code: AssetCode, amount: number) {
  const kp = treasury();
  if (!kp) throw new HttpError(503, "Faucet treasury is not configured (FAUCET_TREASURY_SECRET).", "NOT_CONFIGURED");
  const tb = await getBalances(kp.publicKey());
  const have = code === "XLM" ? tb.xlmAvailable : tb.usdc ?? "0";
  if (toStroops(trim(have)) < toStroops(amount.toFixed(7))) throw new HttpError(503, `Faucet treasury is low on ${code}. Please try later.`, "TREASURY_LOW");
  const src = await horizon().loadAccount(kp.publicKey());
  const tx = new TransactionBuilder(new Account(src.accountId(), src.sequenceNumber()), { fee: "1000", networkPassphrase: network().passphrase })
    .setTimeout(120)
    .addOperation(Operation.payment({ destination: to, asset: asset(code), amount: toSdkAmount(toStroops(amount.toFixed(7))) }))
    .build();
  tx.sign(kp);
  return submitClassic(tx);
}

function trim(v: string) {
  const [w, f = ""] = v.split(".");
  return f ? `${w}.${f.slice(0, 7)}` : w;
}

async function dailyCapCheck(code: AssetCode, amount: number) {
  const { data } = await db().rpc("faucet_sent_today", { p_asset: code });
  if (Number(data ?? 0) + amount > env().FAUCET_DAILY_TREASURY_CAP) throw new HttpError(429, "Today's faucet budget is used up. Try again tomorrow.", "DAILY_CAP");
}

async function ipCheck(ipHash: string) {
  const since = new Date(Date.now() - 86_400_000).toISOString();
  const { count } = await db().from("faucet_claims").select("id", { count: "exact", head: true }).eq("ip_hash", ipHash).gte("created_at", since).neq("status", "failed");
  if ((count ?? 0) >= env().FAUCET_MAX_CLAIMS_PER_IP_PER_DAY * 3) throw new HttpError(429, "Too many faucet claims from this network today.", "IP_LIMIT");
}

/**
 * Claims are anti-Sybil limited by: verified Privy email identity (one profile
 * per email), one signup grant per profile, per-profile cooldown windows
 * enforced by a UNIQUE idempotency key, a per-IP daily limit, a daily
 * treasury cap, and a live treasury balance check.
 */
export async function claim(c: Caller, kind: "signup" | "repeat", code: AssetCode, ipHash: string) {
  const reason = disabledReason();
  if (reason) throw new HttpError(403, reason, "FAUCET_DISABLED");
  if (!c.wallet) throw new HttpError(409, "Create your wallet first.", "NO_WALLET");
  await ipCheck(ipHash);
  const e = env();
  const bal = await getBalances(c.wallet);

  if (kind === "signup" && code === "XLM") {
    if (bal.exists) {
      // Already activated (e.g. funded externally): record nothing, nothing to do.
      return { status: "confirmed" as const, hash: null, note: "Your account is already active." };
    }
    const id = await reserveSlot(c, `${c.profile.id}:signup:XLM`, "signup", "XLM", 10_000, ipHash);
    try {
      const hash = await friendbot(c.wallet);
      await finish(id, { status: "confirmed", hash: hash ?? undefined });
      return { status: "confirmed" as const, hash };
    } catch (err) {
      await finish(id, { status: "failed", error: (err as Error).message });
      throw err;
    }
  }

  if (!bal.exists) throw new HttpError(409, "Activate your account with testnet XLM first.", "NOT_ACTIVATED");
  if (code === "USDC" && bal.usdc === null) throw new HttpError(409, "Add the USDC trustline first, then claim.", "NEEDS_TRUSTLINE");

  const amount =
    kind === "signup" ? e.FAUCET_USDC_NEW_USER_AMOUNT : code === "XLM" ? e.FAUCET_XLM_CLAIM_AMOUNT : e.FAUCET_USDC_CLAIM_AMOUNT;
  if (!(amount > 0)) throw new HttpError(403, "This faucet amount is set to zero.", "FAUCET_DISABLED");
  if (kind === "signup" && code !== "USDC") throw new HttpError(422, "Invalid claim.");
  await dailyCapCheck(code, amount);
  const window = Math.floor(Date.now() / cooldownMs());
  const key = kind === "signup" ? `${c.profile.id}:signup:USDC` : `${c.profile.id}:repeat:${code}:${window}`;
  const id = await reserveSlot(c, key, kind, code, amount, ipHash);
  let r: Awaited<ReturnType<typeof sendFromTreasury>>;
  try {
    r = await sendFromTreasury(c.wallet, code, amount);
  } catch (err) {
    // Nothing was sent (pre-send check or build failed): free the slot.
    await finish(id, { status: "failed", error: (err as Error).message });
    throw err;
  }
  // From here a transaction may exist: only a definitive network failure frees the slot.
  await finish(id, r.status === "failed" ? { status: "failed", hash: r.hash, error: r.error } : { status: r.status, hash: r.hash }).catch((e) =>
    console.error("[faucet] bookkeeping failed after send", id, (e as Error).message),
  );
  if (r.status === "failed") throw new HttpError(502, r.error, "FAUCET_TX_FAILED");
  return { status: r.status, hash: r.hash };
}
