import { NextRequest } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/server/auth";
import { bad, body, notFound, ok, rateLimit, route } from "@/lib/server/http";
import { db, PUBLIC_PROFILE_FIELDS } from "@/lib/server/supabase";

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

/**
 * People row on Home: the accounts you follow first, then a few newer accounts
 * you might want to follow.
 */
export const GET = route(async (req: NextRequest) => {
  const c = await requireUser(req);
  const { data: f } = await db().from("follows").select("followee_id").eq("follower_id", c.profile.id).order("created_at", { ascending: false }).limit(12);
  const ids = ((f ?? []) as { followee_id: string }[]).map((r) => r.followee_id);
  const following = ids.length ? (((await db().from("profiles").select(PUBLIC_PROFILE_FIELDS).in("id", ids).eq("is_banned", false)).data ?? []) as unknown as { id: string }[]) : [];
  const { data: more } = await db().from("profiles").select(PUBLIC_PROFILE_FIELDS).not("username", "is", null).eq("is_banned", false).neq("id", c.profile.id).order("created_at", { ascending: false }).limit(24);
  const seen = new Set(ids);
  const suggested = ((more ?? []) as unknown as { id: string }[]).filter((p) => !seen.has(p.id)).slice(0, Math.max(0, 12 - following.length));
  return ok([
    ...ids.map((id) => following.find((p) => p.id === id)).filter(Boolean).map((p) => ({ ...p, following: true })),
    ...suggested.map((p) => ({ ...p, following: false })),
  ]);
});
