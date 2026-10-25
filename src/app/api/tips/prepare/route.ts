import { NextRequest } from "next/server";
import { z } from "zod";
import { requireUser, requireWallet, walletOf } from "@/lib/server/auth";
import { buildSplitPayment } from "@/lib/server/commerce";
import { bad, body, notFound, ok, rateLimit, route } from "@/lib/server/http";
import { createIntent } from "@/lib/server/intents";
import { db, must } from "@/lib/server/supabase";
import { formatAmount, fromStroops, toStroops } from "@/lib/stellar/amount";

const Body = z.object({
  postId: z.string().uuid().optional(),
  username: z.string().optional(),
  asset: z.enum(["XLM", "USDC"]),
  amount: z.string(),
});

export const POST = route(async (req: NextRequest) => {
  const c = await requireUser(req);
  const from = requireWallet(c);
  await rateLimit(`tip:${c.profile.id}`, 20, 60);
  const b = await body(req, Body);
  let toId: string | null = null;
  if (b.postId) {
    const p = await db().from("posts").select("author_id").eq("id", b.postId).eq("status", "active").maybeSingle();
    if (!p.data) throw notFound("Post not found");
    toId = p.data.author_id;
  } else if (b.username) {
    const u = await db().from("profiles").select("id").eq("username", b.username.replace(/^@/, "").toLowerCase()).maybeSingle();
    toId = u.data?.id ?? null;
  }
  if (!toId) throw notFound("Creator not found");
  if (toId === c.profile.id) throw bad("You cannot tip yourself.");
  const creator = await walletOf(toId);
  if (!creator) throw bad("This creator has no wallet yet.");
  const gross = toStroops(b.amount);
  if (gross < 100_000n) throw bad("Minimum tip is 0.01");
  const { tx, net, fee } = await buildSplitPayment(from, creator, b.asset, gross, "Senda tip");
  const creatorName = (await db().from("profiles").select("username").eq("id", toId).single()).data?.username;
  const intent = await createIntent({
    caller: c, kind: "tip", provider: "stellar", tx,
    payload: { toId, postId: b.postId ?? null, asset: b.asset },
    summary: {
      title: `Tip @${creatorName} ${formatAmount(gross, 7)} ${b.asset}`,
      lines: [
        { label: "Creator receives", value: `${formatAmount(net, 7)} ${b.asset}` },
        { label: "Platform fee", value: `${formatAmount(fee, 7)} ${b.asset}` },
        { label: "Total", value: `${formatAmount(gross, 7)} ${b.asset}` },
      ],
    },
  });
  must(await db().from("tips").insert({ from_id: c.profile.id, to_id: toId, post_id: b.postId ?? null, intent_id: intent.intentId, amount: fromStroops(gross), fee: fromStroops(fee), asset: b.asset }));
  await db().from("workflow_runs").insert({ workflow_key: "TIP", provider: "stellar", intent_id: intent.intentId, status: "prepared" });
  return ok(intent);
});
