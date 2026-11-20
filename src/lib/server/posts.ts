import "server-only";
import { db, PUBLIC_PROFILE_FIELDS } from "./supabase";
import { supabaseOrigin } from "../supabaseUrl";

export type PostRow = {
  id: string; author_id: string; body: string; repost_of: string | null; is_premium: boolean; status: string;
  like_count: number; comment_count: number; repost_count: number; tip_total_usdc: string; created_at: string;
};

const PUBLIC_BASE = () => `${supabaseOrigin(process.env.NEXT_PUBLIC_SUPABASE_URL)}/storage/v1/object/public/public-media/`;

/** The seller sets the price of a post, in USDC, within these limits. No bidding yet. */
/** How many buyers are named on a post; the rest are counted. */
const OWNERS_SHOWN = 5;

export const POST_PRICE_LIMITS = { min: "0.1", max: "100000", asset: "USDC" } as const;

/**
 * Adds authors, viewer state, sale info and media URLs. Everything in a post is
 * public: buying a post makes you an owner, it does not unlock anything.
 */
export async function enrichPosts(rows: PostRow[], viewerId: string | null) {
  if (!rows.length) return [];
  const repostIds = rows.map((r) => r.repost_of).filter(Boolean) as string[];
  const originals = repostIds.length ? ((await db().from("posts").select("*").in("id", repostIds).eq("status", "active")).data ?? []) as PostRow[] : [];
  const all = [...rows, ...originals];
  const ids = [...new Set(all.map((r) => r.id))];
  const authorIds = [...new Set(all.map((r) => r.author_id))];
  const [authors, media, products, likes] = await Promise.all([
    db().from("profiles").select(PUBLIC_PROFILE_FIELDS).in("id", authorIds),
    db().from("post_media").select("id, post_id, bucket, storage_path, mime, is_premium").in("post_id", ids),
    db().from("products").select("id, post_id, price, asset, seller_id").in("post_id", ids),
    viewerId ? db().from("likes").select("post_id").eq("profile_id", viewerId).in("post_id", ids) : Promise.resolve({ data: [] as { post_id: string }[] }),
  ]);
  const productList = (products.data ?? []) as { id: string; post_id: string; price: string; asset: string; seller_id: string }[];
  const entitled = new Set<string>();
  const owners = new Map<string, number>();
  // Buyers' names shown on the post: the most recent few per post.
  const ownerIds = new Map<string, string[]>();
  type Owner = { id: string; username: string; display_name: string | null; avatar_url: string | null };
  const ownerProfiles = new Map<string, Owner>();
  if (productList.length) {
    const ents = await db().from("entitlements").select("product_id, profile_id").in("product_id", productList.map((p) => p.id)).order("granted_at", { ascending: false });
    for (const e of (ents.data ?? []) as { product_id: string; profile_id: string }[]) {
      owners.set(e.product_id, (owners.get(e.product_id) ?? 0) + 1);
      if (e.profile_id === viewerId) entitled.add(e.product_id);
      const list = ownerIds.get(e.product_id) ?? [];
      if (list.length < OWNERS_SHOWN) ownerIds.set(e.product_id, [...list, e.profile_id]);
    }
    const ids = [...new Set([...ownerIds.values()].flat())];
    if (ids.length) {
      const { data } = await db().from("profiles").select("id, username, display_name, avatar_url").in("id", ids);
      for (const o of (data ?? []) as Owner[]) ownerProfiles.set(o.id, o);
    }
  }
  const authorMap = new Map((authors.data ?? []).map((a: { id: string }) => [a.id, a]));
  const likedSet = new Set(((likes.data ?? []) as { post_id: string }[]).map((l) => l.post_id));
  const mediaRows = (media.data ?? []) as { id: string; post_id: string; bucket: string; storage_path: string; mime: string; is_premium: boolean }[];

  const shape = async (r: PostRow): Promise<Record<string, unknown>> => {
    const product = productList.find((p) => p.post_id === r.id) ?? null;
    const owned = product ? entitled.has(product.id) : false;
    const m = await Promise.all(
      mediaRows.filter((x) => x.post_id === r.id).map(async (x) => {
        if (!x.is_premium) return { id: x.id, mime: x.mime, url: PUBLIC_BASE() + x.storage_path, locked: false };
        const s = await db().storage.from("premium-media").createSignedUrl(x.storage_path, 600);
        return { id: x.id, mime: x.mime, url: s.data?.signedUrl ?? null, locked: false };
      }),
    );
    let premiumBody: string | null = null;
    if (r.is_premium) {
      // Older posts kept extra text in a separate table. It is public now.
      const pc = await db().from("post_premium_content").select("body").eq("post_id", r.id).maybeSingle();
      premiumBody = pc.data?.body || null;
    }
    return {
      ...r,
      author: authorMap.get(r.author_id) ?? null,
      liked: likedSet.has(r.id),
      media: m,
      product: product ? { id: product.id, price: product.price, asset: product.asset } : null,
      owned,
      owners: product ? owners.get(product.id) ?? 0 : 0,
      ownerList: product ? (ownerIds.get(product.id) ?? []).map((id) => ownerProfiles.get(id)).filter((o) => o?.username).map((o) => ({ username: o!.username, display_name: o!.display_name, avatar_url: o!.avatar_url })) : [],
      premiumBody,
    };
  };
  const shapedOriginals = new Map(await Promise.all(originals.map(async (o) => [o.id, await shape(o)] as const)));
  return Promise.all(rows.map(async (r) => ({ ...(await shape(r)), original: r.repost_of ? shapedOriginals.get(r.repost_of) ?? null : null })));
}
