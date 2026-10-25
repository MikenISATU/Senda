import { NextRequest } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/server/auth";
import { bad, body, notFound, ok, rateLimit, route } from "@/lib/server/http";
import { db } from "@/lib/server/supabase";

export const POST = route(async (req: NextRequest) => {
  const c = await requireUser(req);
  await rateLimit(`follow:${c.profile.id}`, 60, 60);
  const b = await body(req, z.object({ username: z.string(), follow: z.boolean() }));
  const t = await db().from("profiles").select("id").eq("username", b.username.toLowerCase()).maybeSingle();
  if (!t.data) throw notFound();
  if (t.data.id === c.profile.id) throw bad("You cannot follow yourself.");
  if (b.follow) {
    const { error } = await db().from("follows").insert({ follower_id: c.profile.id, followee_id: t.data.id });
    if (!error) await db().from("notifications").insert({ profile_id: t.data.id, type: "follow", actor_id: c.profile.id, entity_type: "profile", entity_id: c.profile.id, body: "started following you" });
  } else {
    await db().from("follows").delete().eq("follower_id", c.profile.id).eq("followee_id", t.data.id);
  }
  return ok({ following: b.follow });
});
