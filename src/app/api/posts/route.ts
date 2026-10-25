import { NextRequest } from "next/server";
import { z } from "zod";
import { optionalUser, requireUser } from "@/lib/server/auth";
import { bad, body, ok, rateLimit, route } from "@/lib/server/http";
import { enrichPosts, type PostRow } from "@/lib/server/posts";
import { db, must } from "@/lib/server/supabase";
import { toStroops } from "@/lib/stellar/amount";

export const GET = route(async (req: NextRequest) => {
  const viewer = await optionalUser(req);
  const sp = req.nextUrl.searchParams;
  const feed = sp.get("feed") ?? "explore";
  const before = sp.get("before");
  const author = sp.get("author");
  let q = db().from("posts").select("*");
  if (feed === "owned") {
    if (!viewer) return ok({ items: [], next: null });
    const owned = must(await db().from("entitlements").select("product:products(post_id)").eq("profile_id", viewer.profile.id)) as unknown as { product: { post_id: string } | null }[];
    const ids = owned.map((e) => e.product?.post_id).filter(Boolean) as string[];
    if (!ids.length) return ok({ items: [], next: null });
    q = q.in("id", ids).in("status", ["active", "removed"]);
  } else {
    q = q.eq("status", "active");
  }
  if (author) q = q.eq("author_id", author);
  else if (feed === "following") {
    if (!viewer) return ok({ items: [], next: null });
    const f = await db().from("follows").select("followee_id").eq("follower_id", viewer.profile.id);
    const ids = [viewer.profile.id, ...((f.data ?? []) as { followee_id: string }[]).map((x) => x.followee_id)];
    q = q.in("author_id", ids);
  } else if (feed === "premium") q = q.eq("is_premium", true);
  q = q.order("created_at", { ascending: false }).limit(20);
  if (before) q = q.lt("created_at", before);
  const rows = must(await q) as PostRow[];
  const items = await enrichPosts(rows, viewer?.profile.id ?? null);
  return ok({ items, next: rows.length === 20 ? rows[rows.length - 1].created_at : null });
});

const MediaRef = z.object({
  path: z.string().regex(/^[0-9a-f-]{36}\/[\w.-]{1,120}$/),
  bucket: z.enum(["public-media", "premium-media"]),
  mime: z.string().max(100),
  size: z.number().int().positive().max(26214400),
});
const Body = z.object({
  body: z.string().trim().max(2000),
  media: z.array(MediaRef).max(4).default([]),
  premium: z.object({ price: z.string(), asset: z.enum(["XLM", "USDC"]), body: z.string().trim().max(20000) }).optional(),
});

export const POST = route(async (req: NextRequest) => {
  const c = await requireUser(req);
  await rateLimit(`post:${c.profile.id}`, 10, 60);
  const b = await body(req, Body);
  if (!c.profile.username) throw bad("Pick a username first.");
  if (!b.body && !b.media.length && !b.premium) throw bad("Write something first.");
  for (const m of b.media) {
    if (!m.path.startsWith(`${c.profile.id}/`)) throw bad("Invalid media path");
    if (m.bucket === "premium-media" && !b.premium) throw bad("Premium media needs a price");
  }
  if (b.premium) {
    const s = toStroops(b.premium.price);
    if (s < 1_000_000n) throw bad("Minimum price is 0.1");
    if (!c.wallet) throw bad("Create your wallet before selling content.");
  }
  const post = must(await db().from("posts").insert({ author_id: c.profile.id, body: b.body, is_premium: !!b.premium }).select("*").single()) as PostRow;
  if (b.media.length) {
    must(await db().from("post_media").insert(b.media.map((m) => ({ post_id: post.id, bucket: m.bucket, storage_path: m.path, mime: m.mime, size_bytes: m.size, is_premium: m.bucket === "premium-media" }))));
  }
  if (b.premium) {
    must(await db().from("post_premium_content").insert({ post_id: post.id, body: b.premium.body }));
    must(await db().from("products").insert({ post_id: post.id, seller_id: c.profile.id, price: b.premium.price, asset: b.premium.asset }));
  }
  const [item] = await enrichPosts([post], c.profile.id);
  return ok(item);
});
