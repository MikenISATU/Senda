import "server-only";
import { db, PUBLIC_PROFILE_FIELDS } from "./supabase";
import { supabaseOrigin } from "../supabaseUrl";

export type PostRow = {
  id: string; author_id: string; body: string; repost_of: string | null; is_premium: boolean; status: string;
  like_count: number; comment_count: number; repost_count: number; tip_total_usdc: string; created_at: string;
};

const PUBLIC_BASE = () => `${supabaseOrigin(process.env.NEXT_PUBLIC_SUPABASE_URL)}/storage/v1/object/public/public-media/`;

/** Adds authors, viewer state, product/entitlement and media URLs. Premium media only via signed URLs for entitled viewers. */
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
  let entitled = new Set<string>();
  if (viewerId && productList.length) {
    const ents = await db().from("entitlements").select("product_id").eq("profile_id", viewerId).in("product_id", productList.map((p) => p.id));
    entitled = new Set((ents.data ?? []).map((e: { product_id: string }) => e.product_id));
  }
  const authorMap = new Map((authors.data ?? []).map((a: { id: string }) => [a.id, a]));
  const likedSet = new Set(((likes.data ?? []) as { post_id: string }[]).map((l) => l.post_id));
  const mediaRows = (media.data ?? []) as { id: string; post_id: string; bucket: string; storage_path: string; mime: string; is_premium: boolean }[];

  const shape = async (r: PostRow): Promise<Record<string, unknown>> => {
    const product = productList.find((p) => p.post_id === r.id) ?? null;
    const unlocked = !r.is_premium || r.author_id === viewerId || (product ? entitled.has(product.id) : false);
    const m = await Promise.all(
      mediaRows.filter((x) => x.post_id === r.id).map(async (x) => {
        if (!x.is_premium) return { id: x.id, mime: x.mime, url: PUBLIC_BASE() + x.storage_path, locked: false };
        if (!unlocked) return { id: x.id, mime: x.mime, url: null, locked: true };
        const s = await db().storage.from("premium-media").createSignedUrl(x.storage_path, 600);
        return { id: x.id, mime: x.mime, url: s.data?.signedUrl ?? null, locked: false };
      }),
    );
    let premiumBody: string | null = null;
    if (r.is_premium && unlocked) {
      const pc = await db().from("post_premium_content").select("body").eq("post_id", r.id).maybeSingle();
      premiumBody = pc.data?.body ?? "";
    }
    return {
      ...r,
      author: authorMap.get(r.author_id) ?? null,
      liked: likedSet.has(r.id),
      media: m,
      product: product ? { id: product.id, price: product.price, asset: product.asset } : null,
      unlocked,
      premiumBody,
    };
  };
  const shapedOriginals = new Map(await Promise.all(originals.map(async (o) => [o.id, await shape(o)] as const)));
  return Promise.all(rows.map(async (r) => ({ ...(await shape(r)), original: r.repost_of ? shapedOriginals.get(r.repost_of) ?? null : null })));
}
