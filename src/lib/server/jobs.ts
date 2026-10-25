import "server-only";
import type { Caller } from "./auth";
import { forbidden, notFound } from "./http";
import { db, must } from "./supabase";

export type JobRow = {
  id: string; client_id: string; freelancer_id: string | null; title: string; description: string; role: string | null;
  budget: string; asset: "XLM" | "USDC"; deadline: string; status: string; agreed_amount: string | null; created_at: string; updated_at: string;
};

export async function loadJob(id: string): Promise<JobRow> {
  const j = must(await db().from("jobs").select("*").eq("id", id).maybeSingle()) as JobRow | null;
  if (!j) throw notFound("Job not found");
  return j;
}

export function roleIn(job: JobRow, c: Caller): "client" | "freelancer" | "mediator" | "viewer" {
  if (job.client_id === c.profile.id) return "client";
  if (job.freelancer_id && job.freelancer_id === c.profile.id) return "freelancer";
  if (c.profile.role === "mediator" || c.profile.role === "admin") return "mediator";
  return "viewer";
}

export function requireParty(job: JobRow, c: Caller, ...allowed: ("client" | "freelancer" | "mediator")[]) {
  const r = roleIn(job, c);
  if (r === "viewer" || !allowed.includes(r)) throw forbidden("You are not part of this job.");
  return r;
}

export async function ensureJobConversation(job: JobRow) {
  const existing = await db().from("conversations").select("id").eq("job_id", job.id).maybeSingle();
  if (existing.data) return existing.data.id as string;
  const conv = must(await db().from("conversations").insert({ kind: "job", job_id: job.id }).select("id").single()) as { id: string };
  const members = [job.client_id, job.freelancer_id].filter(Boolean).map((p) => ({ conversation_id: conv.id, profile_id: p }));
  must(await db().from("conversation_members").insert(members));
  return conv.id;
}

export async function notify(profileId: string, type: string, body: string, actorId: string | null, entityId: string) {
  await db().from("notifications").insert({ profile_id: profileId, type, actor_id: actorId, entity_type: "job", entity_id: entityId, body });
}
