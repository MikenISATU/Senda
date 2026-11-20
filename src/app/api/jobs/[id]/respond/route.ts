import { NextRequest } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/server/auth";
import { systemMessage } from "@/lib/server/effects";
import { bad, body, forbidden, ok, route } from "@/lib/server/http";
import { ensureJobConversation, loadJob, notify } from "@/lib/server/jobs";
import { db, must } from "@/lib/server/supabase";

export const POST = route(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const c = await requireUser(req);
  const b = await body(req, z.object({ offerId: z.string().uuid(), accept: z.boolean() }));
  const job = await loadJob(id);
  const offer = must(await db().from("job_offers").select("*").eq("id", b.offerId).eq("job_id", id).maybeSingle()) as
    | { id: string; freelancer_id: string; amount: string; deadline: string; status: string }
    | null;
  if (!offer || offer.status !== "pending") throw bad("This offer is no longer pending.");
  if (offer.freelancer_id !== c.profile.id) throw forbidden();
  if (job.status !== "OFFERED") throw bad("This job is no longer waiting on an offer.");
  // Claim the job transition first so two concurrent answers can't both apply.
  const moved = must(
    await db().from("jobs").update(b.accept ? { status: "AWAITING_FUNDING", freelancer_id: c.profile.id, agreed_amount: offer.amount, deadline: offer.deadline } : { status: "DRAFT" }).eq("id", id).eq("status", "OFFERED").select("*"),
  ) as unknown[];
  if (!moved.length) throw bad("Already answered.");
  await db().from("job_offers").update({ status: b.accept ? "accepted" : "declined", responded_at: new Date().toISOString() }).eq("id", offer.id).eq("status", "pending");
  if (!b.accept) {
    await notify(job.client_id, "offer_declined", `Your offer for "${job.title}" was declined`, c.profile.id, id);
    return ok({ status: "DRAFT" });
  }
  const updated = moved[0];
  await ensureJobConversation({ ...job, freelancer_id: c.profile.id });
  await systemMessage(id, "Offer accepted. The client now funds the escrow; work starts once the funds are locked on-chain.");
  await notify(job.client_id, "offer_accepted", `Offer accepted for "${job.title}". Fund the escrow to start.`, c.profile.id, id);
  return ok(updated);
});
