import { NextRequest } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/server/auth";
import { body, ok, rateLimit, route } from "@/lib/server/http";
import { db } from "@/lib/server/supabase";

export const POST = route(async (req: NextRequest) => {
  const c = await requireUser(req);
  await rateLimit(`report:${c.profile.id}`, 10, 3600);
  const b = await body(req, z.object({ entityType: z.enum(["post", "comment", "profile", "message", "job"]), entityId: z.string().max(64), reason: z.string().trim().min(3).max(500) }));
  const { error } = await db().from("moderation_reports").insert({ reporter_id: c.profile.id, entity_type: b.entityType, entity_id: b.entityId, reason: b.reason });
  if (error && error.code !== "23505") throw new Error(error.message);
  return ok({ reported: true });
});
