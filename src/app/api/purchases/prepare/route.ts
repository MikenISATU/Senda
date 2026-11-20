import { NextRequest } from "next/server";
import { z } from "zod";
import { requireUser, requireWallet, walletOf } from "@/lib/server/auth";
import { buildPay, feeLines } from "@/lib/server/fees";
import { bad, body, conflict, notFound, ok, rateLimit, route } from "@/lib/server/http";
import { createIntent } from "@/lib/server/intents";
import { db, must } from "@/lib/server/supabase";
import { formatAmount, fromStroops, toStroops } from "@/lib/stellar/amount";

/**
 * Buying a post. The price is the one the seller set, read from the product
 * row on the server, never taken from the client. The post stays public for
 * everyone; the buyer is recorded as an owner by confirm_purchase() only after
 * the exact prepared transaction is confirmed on-chain (exactly once).
 */
export const POST = route(async (req: NextRequest) => {
  const c = await requireUser(req);
  const from = requireWallet(c);
  await rateLimit(`buy:${c.profile.id}`, 10, 60);
  const b = await body(req, z.object({ postId: z.string().uuid(), price: z.string().max(40).optional() }));
  const product = must(await db().from("products").select("id, seller_id, price, asset, active, posts!inner(status)").eq("post_id", b.postId).maybeSingle()) as
    | { id: string; seller_id: string; price: string; asset: "XLM" | "USDC"; active: boolean; posts: { status: string } }
    | null;
  if (!product || !product.active || product.posts.status !== "active") throw notFound("This post is not for sale.");
  if (product.seller_id === c.profile.id) throw bad("This is your own post.");
  const owned = await db().from("entitlements").select("id").eq("profile_id", c.profile.id).eq("product_id", product.id).maybeSingle();
  if (owned.data) throw conflict("You already own this post.");
  const inflight = await db().from("purchases").select("intent_id").eq("product_id", product.id).eq("buyer_id", c.profile.id).eq("status", "pending");
  const ids = ((inflight.data ?? []) as { intent_id: string }[]).map((r) => r.intent_id);
  if (ids.length) {
    const live = await db().from("tx_intents").select("id, status").in("id", ids).in("status", ["prepared", "submitted"]);
    if ((live.data ?? []).some((r: { status: string }) => r.status === "submitted")) throw conflict("Your earlier payment for this post is still confirming. Check back in a minute.");
    // Unsigned earlier attempts are abandoned safely: they were never sent.
    if (live.data?.length) await db().from("tx_intents").update({ status: "expired" }).in("id", live.data.map((r: { id: string }) => r.id)).eq("status", "prepared");
  }
  const seller = await walletOf(product.seller_id);
  if (!seller) throw bad("The seller has no wallet.");
  const asset = product.asset;
  const gross = toStroops(product.price);
  // The buyer pays exactly the price they were shown, or nothing at all.
  if (b.price !== undefined) {
    let shown: bigint | null = null;
    try { shown = toStroops(b.price); } catch { /* treated as a mismatch below */ }
    if (shown !== gross) throw conflict(`The price of this post is ${formatAmount(gross, 2)} ${asset}. Refresh and try again.`);
  }
  const p = await buildPay({ from, to: seller, code: asset, gross, kind: "purchase", memo: "Senda purchase" });
  const { tx, fee } = p;
  const intent = await createIntent({
    caller: c, kind: "purchase", provider: p.provider, tx,
    payload: { productId: product.id, postId: b.postId },
    summary: {
      title: `Buy this post for ${formatAmount(gross, 2)} ${asset}`,
      lines: [
        ...feeLines("Creator", p, asset),
        { label: "You get", value: "Ownership of this post, once the payment arrives" },
      ],
    },
  });
  must(await db().from("purchases").insert({ product_id: product.id, buyer_id: c.profile.id, seller_id: product.seller_id, intent_id: intent.intentId, amount: fromStroops(gross), fee: fromStroops(fee), asset }));
  await db().from("workflow_runs").insert({ workflow_key: "POST_PURCHASE", provider: p.provider, intent_id: intent.intentId, status: "prepared" });
  return ok(intent);
});
