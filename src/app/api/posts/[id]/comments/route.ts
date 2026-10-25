import { NextRequest } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/server/auth";
import { body, notFound, ok, rateLimit, route } from "@/lib/server/http";
import { db, must, PUBLIC_PROFILE_FIELDS } from "@/lib/server/supabase";

type Ctx = { params: Promise<{ id: string }> };

export const GET = route(async (_req: NextRequest, { params }: Ctx) => {
  const { id } = await params;
  const rows = must(await db().from("comments").select(`id, body, created_at, author:profiles!comments_author_id_fkey(${PUBLIC_PROFILE_FIELDS})`).eq("post_id", id).eq("status", "active").order("created_at", { ascending: true }).limit(200));
  return ok(rows);
});

export const POST = route(async (req: NextRequest, { params }: Ctx) => {
  const { id } = await params;
  const c = await requireUser(req);
  await rateLimit(`comment:${c.profile.id}`, 20, 60);
  const b = await body(req, z.object({ body: z.string().trim().min(1).max(1000) }));
  const post = await db().from("posts").select("author_id").eq("id", id).eq("status", "active").maybeSingle();
  if (!post.data) throw notFound();
  const row = must(await db().from("comments").insert({ post_id: id, author_id: c.profile.id, body: b.body }).select("id, body, created_at").single());
  if (post.data.author_id !== c.profile.id) {
    await db().from("notifications").insert({ profile_id: post.data.author_id, type: "comment", actor_id: c.profile.id, entity_type: "post", entity_id: id, body: "commented on your post" });
  }
  return ok(row);
});
