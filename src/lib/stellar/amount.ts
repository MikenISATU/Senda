/**
 * Exact decimal <-> stroop conversion. Stellar amounts have 7 decimals.
 * Never use floating point for money.
 */
export const STROOPS_PER_UNIT = 10_000_000n;
const AMOUNT_RE = /^(?:0|[1-9]\d{0,11})(?:\.\d{1,7})?$/;

export class AmountError extends Error {}

/** "12.5" -> 125000000n. Rejects negatives, exponents, >7 decimals, > 1e12. */
export function toStroops(amount: string): bigint {
  const s = amount.trim();
  if (!AMOUNT_RE.test(s)) throw new AmountError("Enter an amount with up to 7 decimals.");
  const [whole, frac = ""] = s.split(".");
  return BigInt(whole) * STROOPS_PER_UNIT + BigInt(frac.padEnd(7, "0"));
}

/** 125000000n -> "12.5" */
export function fromStroops(stroops: bigint): string {
  const neg = stroops < 0n;
  const v = neg ? -stroops : stroops;
  const whole = v / STROOPS_PER_UNIT;
  const frac = (v % STROOPS_PER_UNIT).toString().padStart(7, "0").replace(/0+$/, "");
  return `${neg ? "-" : ""}${whole}${frac ? "." + frac : ""}`;
}

/** Stellar SDK amount strings ("12.5000000") from stroops. */
export function toSdkAmount(stroops: bigint): string {
  if (stroops <= 0n) throw new AmountError("Amount must be positive.");
  const whole = stroops / STROOPS_PER_UNIT;
  const frac = (stroops % STROOPS_PER_UNIT).toString().padStart(7, "0");
  return `${whole}.${frac}`;
}

/** floor(amount * bps / 10000); fee + net === amount always. */
export function splitFee(stroops: bigint, bps: number): { net: bigint; fee: bigint } {
  if (!Number.isInteger(bps) || bps < 0 || bps > 10_000) throw new AmountError("Invalid fee rate.");
  if (stroops < 0n) throw new AmountError("Negative amount.");
  const fee = (stroops * BigInt(bps)) / 10_000n;
  return { net: stroops - fee, fee };
}

export function formatAmount(value: string | number | bigint, maxDecimals = 2): string {
  const s = typeof value === "bigint" ? fromStroops(value) : String(value);
  const [w, f = ""] = s.split(".");
  const wholeFmt = BigInt(w.replace("-", "") || "0").toLocaleString("en-US");
  const frac = f.slice(0, maxDecimals).replace(/0+$/, "");
  return `${w.startsWith("-") ? "-" : ""}${wholeFmt}${frac ? "." + frac : ""}`;
}
