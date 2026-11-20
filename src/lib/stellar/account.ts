import "server-only";
import { NotFoundError } from "@stellar/stellar-sdk";
import { fromStroops, toStroops } from "./amount";
import { horizon, network, type AssetCode } from "./network";

export type Balances = {
  exists: boolean;
  xlm: string;
  usdc: string | null; // null = no USDC trustline
  xlmAvailable: string; // after minimum reserve
  subentries: number;
};

export async function loadAccountOrNull(address: string) {
  try {
    return await horizon().loadAccount(address);
  } catch (e) {
    if (e instanceof NotFoundError || (e as { response?: { status?: number } })?.response?.status === 404) return null;
    throw e;
  }
}

/** Live balances straight from Horizon. Never cached as authority. */
export async function getBalances(address: string): Promise<Balances> {
  const acct = await loadAccountOrNull(address);
  if (!acct) return { exists: false, xlm: "0", usdc: null, xlmAvailable: "0", subentries: 0 };
  const issuer = network().usdcIssuer;
  let xlm = "0";
  let usdc: string | null = null;
  let sellingLiabilities = "0";
  for (const b of acct.balances) {
    if (b.asset_type === "native") {
      xlm = b.balance;
      sellingLiabilities = b.selling_liabilities ?? "0";
    } else if ("asset_code" in b && b.asset_code === "USDC" && b.asset_issuer === issuer) {
      usdc = b.balance;
    }
  }
  // Minimum balance = (2 + subentries + sponsoring - sponsored) * 0.5 XLM.
  const subentries = acct.subentry_count;
  const sponsoring = Number(acct.num_sponsoring ?? 0);
  const sponsored = Number(acct.num_sponsored ?? 0);
  const reserve = BigInt(2 + subentries + sponsoring - sponsored) * 5_000_000n;
  const avail = toStroops(trim7(xlm)) - reserve - toStroops(trim7(sellingLiabilities));
  return { exists: true, xlm, usdc, xlmAvailable: fromStroops(avail > 0n ? avail : 0n), subentries };
}

function trim7(v: string) {
  const [w, f = ""] = v.split(".");
  return f ? `${w}.${f.slice(0, 7)}` : w;
}

export async function hasTrustline(address: string, code: AssetCode) {
  if (code === "XLM") return true;
  const b = await getBalances(address);
  return b.usdc !== null;
}

export type HistoryItem = {
  id: string;
  txHash: string;
  createdAt: string;
  direction: "in" | "out";
  type: string;
  asset: AssetCode | string;
  amount: string;
  counterparty: string | null;
};

/** Payment-like operations for an account (newest first). */
export async function getPaymentHistory(address: string, limit = 30, cursor?: string): Promise<{ items: HistoryItem[]; next?: string }> {
  let q = horizon().payments().forAccount(address).order("desc").limit(limit);
  if (cursor) q = q.cursor(cursor);
  try {
    const page = await q.call();
    const issuer = network().usdcIssuer;
    const items: HistoryItem[] = [];
    for (const r of page.records) {
      const rec = r as unknown as Record<string, string>;
      let assetCode: string;
      if (rec.asset_type === "native") assetCode = "XLM";
      else if (rec.asset_code === "USDC" && rec.asset_issuer === issuer) assetCode = "USDC";
      else assetCode = rec.asset_code ?? "OTHER";
      if (r.type === "create_account") {
        items.push({
          id: r.id, txHash: r.transaction_hash, createdAt: r.created_at, type: r.type,
          direction: rec.account === address ? "in" : "out", asset: "XLM", amount: rec.starting_balance,
          counterparty: rec.account === address ? rec.funder : rec.account,
        });
      } else if (r.type === "payment" || r.type.startsWith("path_payment")) {
        const incoming = rec.to === address;
        items.push({
          id: r.id, txHash: r.transaction_hash, createdAt: r.created_at, type: r.type,
          direction: incoming ? "in" : "out", asset: assetCode, amount: rec.amount,
          counterparty: incoming ? rec.from : rec.to,
        });
      }
    }
    const last = page.records[page.records.length - 1];
    return { items, next: last?.paging_token };
  } catch (e) {
    if ((e as { response?: { status?: number } })?.response?.status === 404) return { items: [] };
    throw e;
  }
}
