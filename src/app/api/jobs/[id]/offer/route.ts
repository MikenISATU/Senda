import { NextRequest } from "next/server";
import { z } from "zod";
import { requireUser, walletOf } from "@/lib/server/auth";
import { bad, body, forbidden, ok, route } from "@/lib/server/http";
import { loadJob, notify } from "@/lib/server/jobs";
import { db, must } from "@/lib/server/supabase";
import { toStroops } from "@/lib/stellar/amount";

/** Client sends an offer (exact amount, asset, deadline) to one freelancer. */
export const POST = route(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const c = await requireUser(req);
  const b = await body(req, z.object({ freelancerId: z.string().uuid(), amount: z.string(), deadline: z.string().datetime() }));
  const job = await loadJob(id);
  if (job.client_id !== c.profile.id) throw forbidden();
  if (job.status !== "DRAFT") throw bad("An offer is already pending or the job has moved on.");
  if (b.freelancerId === c.profile.id) throw bad("You cannot hire yourself.");
  if (toStroops(b.amount) <= 0n) throw bad("Amount must be positive.");
  if (new Date(b.deadline).getTime() < Date.now() + 3600_000) throw bad("Deadline must be at least 1 hour away.");
  if (!(await walletOf(b.freelancerId))) throw bad("That freelancer has no wallet yet.");
  const offer = must(await db().from("job_offers").insert({ job_id: id, freelancer_id: b.freelancerId, amount: b.amount, asset: job.asset, deadline: b.deadline }).select("*").single());
  await db().from("jobs").update({ status: "OFFERED" }).eq("id", id).eq("status", "DRAFT");
  await notify(b.freelancerId, "offer", `You received an offer for "${job.title}"`, c.profile.id, id);
  return ok(offer);
});
