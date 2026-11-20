import { NextRequest } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { bad, notFound, ok, rateLimit, route } from "@/lib/server/http";
import { db, must } from "@/lib/server/supabase";

export const POST = route(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const c = await requireUser(req);
  await rateLimit(`repost:${c.profile.id}`, 20, 60);
  const orig = await db().from("posts").select("id, author_id, repost_of").eq("id", id).eq("status", "active").maybeSingle();
  if (!orig.data) throw notFound();
  const target = orig.data.repost_of ?? orig.data.id;
  const dup = await db().from("posts").select("id").eq("author_id", c.profile.id).eq("repost_of", target).eq("status", "active").maybeSingle();
  if (dup.data) throw bad("You already reposted this.");
  const row = must(await db().from("posts").insert({ author_id: c.profile.id, body: "", repost_of: target }).select("id").single());
  if (orig.data.author_id !== c.profile.id) {
    await db().from("notifications").insert({ profile_id: orig.data.author_id, type: "repost", actor_id: c.profile.id, entity_type: "post", entity_id: target, body: "reposted your post" });
  }
  return ok(row);
});
