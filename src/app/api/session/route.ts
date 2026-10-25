import { NextRequest } from "next/server";
import { verifiedPrivyId } from "@/lib/server/auth";
import { env } from "@/lib/server/env";
import { ok, rateLimit, route } from "@/lib/server/http";
import { getPrivyIdentity } from "@/lib/server/privy";
import { db, mintSupabaseToken, must } from "@/lib/server/supabase";
import { publicConfig } from "@/lib/server/public-config";

/**
 * Exchanges a verified Privy access token for the caller's Senda profile.
 * Creates the profile on first sign-in. The Privy user id comes ONLY from the
 * verified token; the client never supplies it.
 */
export const POST = route(async (req: NextRequest) => {
  const privyUserId = await verifiedPrivyId(req);
  await rateLimit(`session:${privyUserId}`, 30, 60);
  let link = must(await db().from("profile_private").select("profile_id").eq("privy_user_id", privyUserId).maybeSingle()) as { profile_id: string } | null;
  if (!link) {
    const identity = await getPrivyIdentity(privyUserId);
    const profile = must(await db().from("profiles").insert({}).select("id").single()) as { id: string };
    const { error } = await db().from("profile_private").insert({ profile_id: profile.id, privy_user_id: privyUserId, email: identity.email });
    if (error) {
      await db().from("profiles").delete().eq("id", profile.id);
      if (error.code !== "23505") throw new Error(error.message);
    }
    link = must(await db().from("profile_private").select("profile_id").eq("privy_user_id", privyUserId).single()) as { profile_id: string };
  }
  const profile = must(await db().from("profiles").select("*").eq("id", link.profile_id).single());
  const wallet = must(
    await db().from("linked_wallets").select("address").eq("profile_id", link.profile_id).eq("network", env().STELLAR_NETWORK).eq("is_primary", true).maybeSingle(),
  ) as { address: string } | null;
  const supabase = (profile as { is_banned?: boolean }).is_banned ? null : await mintSupabaseToken(link.profile_id);
  return ok({ profile, wallet: wallet?.address ?? null, supabase, config: publicConfig() });
});
