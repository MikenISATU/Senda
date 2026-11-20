import { NextRequest } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { notFound, ok, rateLimit, route } from "@/lib/server/http";
import { db } from "@/lib/server/supabase";

export const POST = route(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const c = await requireUser(req);
  await rateLimit(`like:${c.profile.id}`, 60, 60);
  const post = await db().from("posts").select("author_id").eq("id", id).eq("status", "active").maybeSingle();
  if (!post.data) throw notFound();
  const existing = await db().from("likes").select("post_id").eq("post_id", id).eq("profile_id", c.profile.id).maybeSingle();
  if (existing.data) {
    await db().from("likes").delete().eq("post_id", id).eq("profile_id", c.profile.id);
    return ok({ liked: false });
  }
  await db().from("likes").insert({ post_id: id, profile_id: c.profile.id });
  if (post.data.author_id !== c.profile.id) {
    await db().from("notifications").insert({ profile_id: post.data.author_id, type: "like", actor_id: c.profile.id, entity_type: "post", entity_id: id, body: "liked your post" });
  }
  return ok({ liked: true });
});
