import { NextRequest } from "next/server";
import { optionalUser, requireUser } from "@/lib/server/auth";
import { readOnchainJob, syncEscrow } from "@/lib/server/escrow";
import { bad, forbidden, ok, route } from "@/lib/server/http";
import { loadJob, roleIn } from "@/lib/server/jobs";
import { db, must, PUBLIC_PROFILE_FIELDS } from "@/lib/server/supabase";

type Ctx = { params: Promise<{ id: string }> };
const PRIVATE = new Set(["OFFERED", "ACCEPTED", "AWAITING_FUNDING", "FUNDED", "IN_PROGRESS", "PROOF_SUBMITTED", "REVISION_REQUESTED", "APPROVED", "DISPUTED", "PAID", "REFUNDED", "RESOLVED"]);

export const GET = route(async (req: NextRequest, { params }: Ctx) => {
  const { id } = await params;
  const viewer = await optionalUser(req);
  let job = await loadJob(id);
  const role = viewer ? roleIn(job, viewer) : "viewer";
  if ((PRIVATE.has(job.status) || job.status === "CANCELLED") && role === "viewer") throw forbidden("This job is private to its participants.");
  // A mediator only sees non-open jobs while they are disputed.
  if (role === "mediator" && job.status !== "DISPUTED" && job.status !== "DRAFT") throw forbidden("This job is private to its participants.");
  let escrow = (await db().from("escrows").select("*").eq("job_id", id).maybeSingle()).data as Record<string, unknown> | null;
  // Refresh from chain if funded and the cache is older than 20s.
  if (escrow && (!escrow.last_synced_at || Date.now() - new Date(String(escrow.last_synced_at)).getTime() > 20_000)) {
    await syncEscrow(id).catch(() => null);
    job = await loadJob(id);
    escrow = (await db().from("escrows").select("*").eq("job_id", id).maybeSingle()).data as Record<string, unknown> | null;
  }
  const profiles = must(await db().from("profiles").select(PUBLIC_PROFILE_FIELDS).in("id", [job.client_id, job.freelancer_id].filter(Boolean) as string[])) as { id: string }[];
  const applications = role === "client"
    ? must(await db().from("applications").select(`*, freelancer:profiles!applications_freelancer_id_fkey(${PUBLIC_PROFILE_FIELDS})`).eq("job_id", id).order("created_at"))
    : viewer ? must(await db().from("applications").select("*").eq("job_id", id).eq("freelancer_id", viewer.profile.id)) : [];
  const offers = role === "client" || role === "mediator"
    ? must(await db().from("job_offers").select("*").eq("job_id", id).order("created_at", { ascending: false }))
    : viewer ? must(await db().from("job_offers").select("*").eq("job_id", id).eq("freelancer_id", viewer.profile.id).order("created_at", { ascending: false })) : [];
  const conv = role !== "viewer" ? (await db().from("conversations").select("id").eq("job_id", id).maybeSingle()).data : null;
  return ok({
    job,
    role,
    client: profiles.find((p) => p.id === job.client_id) ?? null,
    freelancer: profiles.find((p) => p.id === job.freelancer_id) ?? null,
    applications,
    offers,
    escrow,
    conversationId: conv?.id ?? null,
    now: Math.floor(Date.now() / 1000),
  });
});

/** Client cancels a job that has no funded escrow. */
export const DELETE = route(async (req: NextRequest, { params }: Ctx) => {
  const { id } = await params;
  const c = await requireUser(req);
  const job = await loadJob(id);
  if (job.client_id !== c.profile.id) throw forbidden();
  if (!["DRAFT", "OFFERED", "ACCEPTED", "AWAITING_FUNDING"].includes(job.status)) throw bad("Funded jobs end through the escrow (approve, refund or dispute).");
  const esc = await db().from("escrows").select("fund_tx, escrow_key").eq("job_id", id).maybeSingle();
  if (esc.data?.fund_tx) throw bad("Escrow already funded.");
  const pendingFund = await db().from("tx_intents").select("id").eq("kind", "escrow_fund").in("status", ["prepared", "submitted"]).contains("payload", { jobId: id }).limit(1);
  if (pendingFund.data?.length) throw bad("A funding transaction is still in progress. Check its status first.");
  if (esc.data?.escrow_key && (await readOnchainJob(esc.data.escrow_key).catch(() => null))) throw bad("Escrow is funded on-chain. End it through the escrow.");
  await db().from("jobs").update({ status: "CANCELLED" }).eq("id", id);
  await db().from("job_offers").update({ status: "withdrawn" }).eq("job_id", id).eq("status", "pending");
  return ok({ status: "CANCELLED" });
});
