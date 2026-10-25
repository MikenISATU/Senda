import { NextRequest } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { ok, route } from "@/lib/server/http";
import { db } from "@/lib/server/supabase";
import { getPaymentHistory } from "@/lib/stellar/account";
import { network } from "@/lib/stellar/network";

/** Authoritative history straight from Horizon, labelled with known Senda users. */
export const GET = route(async (req: NextRequest) => {
  const c = await requireUser(req);
  if (!c.wallet) return ok({ items: [] });
  const cursor = req.nextUrl.searchParams.get("cursor") ?? undefined;
  const page = await getPaymentHistory(c.wallet, 25, cursor);
  const addrs = [...new Set(page.items.map((i) => i.counterparty).filter(Boolean))] as string[];
  const names: Record<string, string> = {};
  if (addrs.length) {
    const { data } = await db().from("linked_wallets").select("address, profiles!inner(username)").in("address", addrs);
    for (const r of (data ?? []) as unknown as { address: string; profiles: { username: string | null } }[]) if (r.profiles.username) names[r.address] = r.profiles.username;
  }
  const explorer = network().explorer;
  return ok({
    items: page.items.map((i) => ({ ...i, counterpartyUsername: i.counterparty ? names[i.counterparty] ?? null : null, explorerUrl: `${explorer}/tx/${i.txHash}` })),
    next: page.next ?? null,
  });
});
