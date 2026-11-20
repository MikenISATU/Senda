import { NextRequest } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/server/auth";
import { bad, body, conflict, ok, rateLimit, route } from "@/lib/server/http";
import { loadJob, notify } from "@/lib/server/jobs";
import { db } from "@/lib/server/supabase";

export const POST = route(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const c = await requireUser(req);
  await rateLimit(`apply:${c.profile.id}`, 20, 3600);
  const b = await body(req, z.object({ note: z.string().trim().min(1).max(2000), proposedAmount: z.string().optional() }));
  const job = await loadJob(id);
  if (job.status !== "DRAFT") throw bad("This job is not accepting applications.");
  if (job.client_id === c.profile.id) throw bad("You posted this job.");
  if (!c.wallet) throw bad("Create your wallet first so you can be paid.");
  const { error } = await db().from("applications").insert({ job_id: id, freelancer_id: c.profile.id, note: b.note, proposed_amount: b.proposedAmount ?? null });
  if (error?.code === "23505") throw conflict("You already applied.");
  if (error) throw new Error(error.message);
  await notify(job.client_id, "application", `New application for "${job.title}"`, c.profile.id, id);
  return ok({ applied: true });
});
