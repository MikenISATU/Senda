import { NextRequest } from "next/server";
import { optionalUser, requireUser } from "@/lib/server/auth";
import { forbidden, notFound, ok, route } from "@/lib/server/http";
import { enrichPosts, type PostRow } from "@/lib/server/posts";
import { db, must } from "@/lib/server/supabase";

type Ctx = { params: Promise<{ id: string }> };

export const GET = route(async (req: NextRequest, { params }: Ctx) => {
  const { id } = await params;
  const viewer = await optionalUser(req);
  const p = must(await db().from("posts").select("*").eq("id", id).eq("status", "active").maybeSingle()) as PostRow | null;
  if (!p) throw notFound("Post not found");
  const [item] = await enrichPosts([p], viewer?.profile.id ?? null);
  return ok(item);
});

export const DELETE = route(async (req: NextRequest, { params }: Ctx) => {
  const { id } = await params;
  const c = await requireUser(req);
  const p = must(await db().from("posts").select("author_id, is_premium").eq("id", id).maybeSingle()) as { author_id: string; is_premium: boolean } | null;
  if (!p) throw notFound();
  if (p.author_id !== c.profile.id) throw forbidden();
  // Soft-remove: buyers keep their purchase records; content is hidden.
  must(await db().from("posts").update({ status: "removed" }).eq("id", id));
  if (p.is_premium) await db().from("products").update({ active: false }).eq("post_id", id);
  return ok({ removed: true });
});
