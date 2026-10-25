import { NextRequest } from "next/server";
import { ok, route } from "@/lib/server/http";
import { db } from "@/lib/server/supabase";

export const GET = route(async (req: NextRequest) => {
  const q = (req.nextUrl.searchParams.get("q") ?? "").trim().toLowerCase().replace(/^@/, "");
  if (!/^[a-z0-9_]{1,20}$/.test(q)) return ok([]);
  const { data } = await db().from("profiles").select("id, username, display_name, avatar_url").ilike("username", `${q}%`).eq("is_banned", false).not("username", "is", null).limit(8);
  return ok(data ?? []);
});
