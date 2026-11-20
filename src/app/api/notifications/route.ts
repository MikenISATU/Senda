import { NextRequest } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { ok, route } from "@/lib/server/http";
import { db, must, PUBLIC_PROFILE_FIELDS } from "@/lib/server/supabase";

export const GET = route(async (req: NextRequest) => {
  const c = await requireUser(req);
  const rows = must(await db().from("notifications").select(`*, actor:profiles!notifications_actor_id_fkey(${PUBLIC_PROFILE_FIELDS})`).eq("profile_id", c.profile.id).order("created_at", { ascending: false }).limit(50));
  return ok(rows);
});

export const POST = route(async (req: NextRequest) => {
  const c = await requireUser(req);
  await db().from("notifications").update({ read_at: new Date().toISOString() }).eq("profile_id", c.profile.id).is("read_at", null);
  return ok({ read: true });
});
