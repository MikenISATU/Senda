import { NextRequest } from "next/server";
import { optionalUser } from "@/lib/server/auth";
import { env } from "@/lib/server/env";
import { notFound, ok, route } from "@/lib/server/http";
import { db, must, PUBLIC_PROFILE_FIELDS } from "@/lib/server/supabase";

export const GET = route(async (req: NextRequest, { params }: { params: Promise<{ username: string }> }) => {
  const { username } = await params;
  const viewer = await optionalUser(req);
  const p = must(await db().from("profiles").select(PUBLIC_PROFILE_FIELDS).eq("username", username.toLowerCase()).eq("is_banned", false).maybeSingle()) as { id: string } | null;
  if (!p) throw notFound("User not found");
  const w = must(await db().from("linked_wallets").select("address").eq("profile_id", p.id).eq("network", env().STELLAR_NETWORK).eq("is_primary", true).maybeSingle()) as { address: string } | null;
  let following = false;
  if (viewer) {
    const f = await db().from("follows").select("follower_id").eq("follower_id", viewer.profile.id).eq("followee_id", p.id).maybeSingle();
    following = !!f.data;
  }
  return ok({ profile: p, wallet: w?.address ?? null, following, isSelf: viewer?.profile.id === p.id });
});
