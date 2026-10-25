import { NextRequest } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { systemMessage } from "@/lib/server/effects";
import { syncEscrow } from "@/lib/server/escrow";
import { bad, forbidden, ok, route } from "@/lib/server/http";
import { loadJob } from "@/lib/server/jobs";
import { db } from "@/lib/server/supabase";

/** Freelancer marks work as started (app-level marker on top of on-chain Funded). */
export const POST = route(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const c = await requireUser(req);
  const job = await loadJob(id);
  if (job.freelancer_id !== c.profile.id) throw forbidden();
  const onchain = await syncEscrow(id);
  if (onchain?.status !== "Funded") throw bad("Work starts only after the escrow is funded on-chain.");
  await db().from("jobs").update({ status: "IN_PROGRESS" }).eq("id", id).eq("status", "FUNDED");
  await systemMessage(id, "Freelancer started work.");
  return ok({ status: "IN_PROGRESS" });
});
