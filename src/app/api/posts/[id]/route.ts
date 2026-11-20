import { NextRequest } from "next/server";
import { optionalUser, requireUser } from "@/lib/server/auth";
import { forbidden, notFound, ok, route } from "@/lib/server/http";
import { enrichPosts, type PostRow } from "@/lib/server/posts";
import { db, must } from "@/lib/server/supabase";

type Ctx = { params: Promise<{ id: string }> };

export const GET = route(async (req: NextRequest, { params }: Ctx) => {
  const { id } = await params;
  const viewer = await optionalUser(req);
  const p = must(await db().from("posts").select("*").eq("id", id).maybeSingle()) as PostRow | null;
  if (!p) throw notFound("Post not found");
  if (p.status !== "active" && p.author_id !== viewer?.profile.id) {
    // A creator removing a sold post stops new sales and removes it from feeds,
    // but does not revoke content a buyer already purchased. Moderation-hidden
    // posts remain unavailable to everyone except their author.
    if (p.status !== "removed" || !p.is_premium || !viewer) throw notFound("Post not found");
    const product = must(await db().from("products").select("id").eq("post_id", p.id).maybeSingle()) as { id: string } | null;
    const entitlement = product
      ? must(await db().from("entitlements").select("id").eq("profile_id", viewer.profile.id).eq("product_id", product.id).maybeSingle())
      : null;
    if (!entitlement) throw notFound("Post not found");
  }
  const [item] = await enrichPosts([p], viewer?.profile.id ?? null);
  return ok(item);
});

export const DELETE = route(async (req: NextRequest, { params }: Ctx) => {
  const { id } = await params;
  const c = await requireUser(req);
  const p = must(await db().from("posts").select("author_id, is_premium").eq("id", id).maybeSingle()) as { author_id: string; is_premium: boolean } | null;
  if (!p) throw notFound();
  if (p.author_id !== c.profile.id) throw forbidden();
  // Soft-remove: stop new sales and hide from feeds. Existing buyers retain
  // direct access to the premium content they purchased.
  must(await db().from("posts").update({ status: "removed" }).eq("id", id));
  if (p.is_premium) await db().from("products").update({ active: false }).eq("post_id", id);
  return ok({ removed: true });
});
