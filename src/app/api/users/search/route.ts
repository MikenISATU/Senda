import { NextRequest } from "next/server";
import { ok, route } from "@/lib/server/http";
import { db } from "@/lib/server/supabase";

type Row = { id: string; username: string; display_name: string | null; avatar_url: string | null; bio: string | null; follower_count: number };

/**
 * Profile search by username or display name. Usernames that start with the
 * query come first (exact match on top), then names that contain it.
 */
export const GET = route(async (req: NextRequest) => {
  const q = (req.nextUrl.searchParams.get("q") ?? "").trim().toLowerCase().replace(/^@/, "").replace(/\s+/g, " ");
  // Letters, numbers, underscore and spaces only: safe to place in a filter.
  if (!/^[a-z0-9_ ]{1,30}$/.test(q)) return ok([]);
  const fields = "id, username, display_name, avatar_url, bio, follower_count";
  const base = () => db().from("profiles").select(fields).eq("is_banned", false).not("username", "is", null);
  const handle = q.replace(/ /g, "");
  const [byUser, byName] = await Promise.all([
    handle ? base().ilike("username", `${handle}%`).order("follower_count", { ascending: false }).limit(8) : Promise.resolve({ data: [] as Row[] }),
    q.length >= 2 ? base().ilike("display_name", `%${q}%`).order("follower_count", { ascending: false }).limit(8) : Promise.resolve({ data: [] as Row[] }),
  ]);
  const seen = new Set<string>();
  const rows = [...((byUser.data ?? []) as Row[]), ...((byName.data ?? []) as Row[])].filter((r) => !seen.has(r.id) && seen.add(r.id));
  rows.sort((a, b) => Number(b.username === handle) - Number(a.username === handle));
  return ok(rows.slice(0, 8));
});
