import { NextRequest } from "next/server";
import { z } from "zod";
import { requireUser, requireWallet } from "@/lib/server/auth";
import { bad, body, conflict, forbidden, notFound, ok, rateLimit, route } from "@/lib/server/http";
import { preparePayment } from "@/lib/server/payments";
import { db } from "@/lib/server/supabase";

type Ctx = { params: Promise<{ id: string }> };
type Req = { id: string; conversation_id: string; requester_id: string; payer_id: string; asset: "XLM" | "USDC"; amount: string; note: string; status: string; intent_id: string | null };

const Body = z.object({ action: z.enum(["pay", "decline", "cancel"]), idempotencyKey: z.string().uuid().optional() });

/**
 * pay:     the payer gets a normal payment to sign. The request is marked paid
 *          only after that payment is confirmed on the ledger.
 * decline: the payer says no.  cancel: the requester withdraws it.
 */
export const POST = route(async (req: NextRequest, { params }: Ctx) => {
  const { id } = await params;
  const c = await requireUser(req);
  await rateLimit(`reqact:${c.profile.id}`, 20, 60);
  const b = await body(req, Body);
  const { data } = await db().from("payment_requests").select("id, conversation_id, requester_id, payer_id, asset, amount, note, status, intent_id").eq("id", id).maybeSingle();
  const r = data as Req | null;
  if (!r) throw notFound();
  if (r.status !== "open") throw conflict(`This request is already ${r.status}.`);

  if (b.action === "pay") {
    if (r.payer_id !== c.profile.id) throw forbidden("Only the person asked can pay this request.");
    const from = requireWallet(c);
    if (r.intent_id) {
      const { data: prev } = await db().from("tx_intents").select("status, expires_at").eq("id", r.intent_id).maybeSingle();
      const p = prev as { status: string; expires_at: string } | null;
      if (p && (p.status === "submitted" || (p.status === "prepared" && new Date(p.expires_at).getTime() > Date.now()))) {
        throw conflict("A payment for this request is already in progress. Give it a moment.");
      }
    }
    const { data: who } = await db().from("profiles").select("username").eq("id", r.requester_id).single();
    const username = (who as { username: string | null } | null)?.username;
    if (!username) throw bad("The requester has no username yet.");
    const intent = await preparePayment(c, from, {
      to: `@${username}`,
      asset: r.asset,
      amount: String(r.amount),
      idempotencyKey: b.idempotencyKey,
      payload: { requestId: r.id, conversationId: r.conversation_id },
      title: `Pay @${username}'s request`,
    });
    // Claim the request for this intent only if nobody else claimed it meanwhile.
    let claim = db().from("payment_requests").update({ intent_id: intent.intentId }).eq("id", r.id).eq("status", "open");
    claim = r.intent_id ? claim.eq("intent_id", r.intent_id) : claim.is("intent_id", null);
    const { data: claimed } = await claim.select("id");
    if (!claimed?.length) throw conflict("A payment for this request is already in progress. Give it a moment.");
    return ok(intent);
  }

  const allowed = b.action === "decline" ? r.payer_id === c.profile.id : r.requester_id === c.profile.id;
  if (!allowed) throw forbidden();
  const status = b.action === "decline" ? "declined" : "cancelled";
  const { data: upd } = await db().from("payment_requests").update({ status, settled_at: new Date().toISOString() }).eq("id", r.id).eq("status", "open").select("id");
  if (upd?.length) {
    await db().from("messages").insert({ conversation_id: r.conversation_id, sender_id: null, kind: "system", body: b.action === "decline" ? "Request declined." : "Request cancelled." });
  }
  return ok({ status });
});
