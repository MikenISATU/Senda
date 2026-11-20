import { NextRequest } from "next/server";
import { z } from "zod";
import { optionalUser, requireUser } from "@/lib/server/auth";
import { bad, body, ok, rateLimit, route } from "@/lib/server/http";
import { db, must, PUBLIC_PROFILE_FIELDS } from "@/lib/server/supabase";
import { toStroops } from "@/lib/stellar/amount";

export const GET = route(async (req: NextRequest) => {
  const scope = req.nextUrl.searchParams.get("scope") ?? "open";
  const viewer = await optionalUser(req);
  let q = db().from("jobs").select(`*, client:profiles!jobs_client_id_fkey(${PUBLIC_PROFILE_FIELDS}), freelancer:profiles!jobs_freelancer_id_fkey(${PUBLIC_PROFILE_FIELDS})`).order("created_at", { ascending: false }).limit(50);
  if (scope === "mine") {
    if (!viewer) return ok([]);
    q = q.or(`client_id.eq.${viewer.profile.id},freelancer_id.eq.${viewer.profile.id}`);
  } else {
    q = q.eq("status", "DRAFT");
  }
  return ok(must(await q));
});

const Body = z.object({
  title: z.string().trim().min(4).max(120),
  description: z.string().trim().min(10).max(5000),
  role: z.string().trim().max(60).optional(),
  budget: z.string(),
  asset: z.enum(["XLM", "USDC"]),
  deadline: z.string().datetime(),
});

export const POST = route(async (req: NextRequest) => {
  const c = await requireUser(req);
  await rateLimit(`job:${c.profile.id}`, 10, 3600);
  const b = await body(req, Body);
  if (!c.profile.username) throw bad("Pick a username first.");
  if (toStroops(b.budget) <= 0n) throw bad("Budget must be positive.");
  const dl = new Date(b.deadline).getTime();
  if (dl < Date.now() + 3600_000) throw bad("Deadline must be at least 1 hour away.");
  if (dl > Date.now() + 365 * 86_400_000) throw bad("Deadline must be within a year.");
  const job = must(await db().from("jobs").insert({ client_id: c.profile.id, title: b.title, description: b.description, role: b.role ?? null, budget: b.budget, asset: b.asset, deadline: b.deadline }).select("*").single());
  return ok(job);
});
