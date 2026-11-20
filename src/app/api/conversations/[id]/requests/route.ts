import { NextRequest } from "next/server";
import { z } from "zod";
import { requireUser, requireWallet } from "@/lib/server/auth";
import { bad, body, forbidden, notFound, ok, rateLimit, route } from "@/lib/server/http";
import { db, must } from "@/lib/server/supabase";
import { formatAmount, toStroops } from "@/lib/stellar/amount";

type Ctx = { params: Promise<{ id: string }> };

const Body = z.object({
  asset: z.enum(["XLM", "USDC"]),
  amount: z.string().trim().min(1).max(30),
  note: z.string().trim().max(140).default(""),
});

/** "Request money" in a two-person DM. Job chats must use the protected escrow flow. */
export const POST = route(async (req: NextRequest, { params }: Ctx) => {
  const { id } = await params;
  const c = await requireUser(req);
  requireWallet(c);
  await rateLimit(`req:${c.profile.id}`, 10, 60);
  const b = await body(req, Body);
  const stroops = toStroops(b.amount);
  if (stroops <= 0n) throw bad("Amount must be greater than zero.");
  if (stroops > 100_000n * 10_000_000n) throw bad("That amount is too large for a request.");

  const members = must(await db().from("conversation_members").select("profile_id").eq("conversation_id", id)) as { profile_id: string }[];
  if (!members.some((m) => m.profile_id === c.profile.id)) throw forbidden();
  const conversation = must(await db().from("conversations").select("kind").eq("id", id).maybeSingle()) as { kind: string } | null;
  if (!conversation) throw notFound("Conversation not found.");
  if (conversation.kind !== "dm") throw bad("Use the job's funded escrow for job payments.");

  const others = members.filter((m) => m.profile_id !== c.profile.id);
  if (others.length !== 1) throw bad("Requests work in one-to-one chats.");
  const payerId = others[0].profile_id;
  const amount = formatAmount(stroops, 7).replace(/,/g, "");

  const msg = must(await db().from("messages").insert({ conversation_id: id, sender_id: c.profile.id, kind: "request", body: b.note }).select("id").single()) as { id: string };
  const r = must(
    await db().from("payment_requests").insert({ conversation_id: id, message_id: msg.id, requester_id: c.profile.id, payer_id: payerId, asset: b.asset, amount, note: b.note }).select("id").single(),
  ) as { id: string };
  await db().from("conversations").update({ last_message_at: new Date().toISOString() }).eq("id", id);
  await db().from("notifications").insert({ profile_id: payerId, type: "request", actor_id: c.profile.id, entity_type: "conversation", entity_id: id, body: `requested ${amount} ${b.asset}` });
  return ok({ id: r.id, messageId: msg.id });
});
