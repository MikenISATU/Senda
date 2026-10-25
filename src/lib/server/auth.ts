import "server-only";
import type { NextRequest } from "next/server";
import { env } from "./env";
import { HttpError, forbidden } from "./http";
import { verifyPrivyToken } from "./privy";
import { db, must } from "./supabase";

export type Profile = {
  id: string;
  username: string | null;
  display_name: string | null;
  bio: string | null;
  avatar_url: string | null;
  role: "user" | "admin" | "mediator";
  is_banned: boolean;
  onboarded_at: string | null;
};

export type Caller = { profile: Profile; privyUserId: string; wallet: string | null };

function bearer(req: NextRequest) {
  const h = req.headers.get("authorization");
  if (!h?.startsWith("Bearer ")) return null;
  return h.slice(7).trim() || null;
}

export async function verifiedPrivyId(req: NextRequest): Promise<string> {
  const token = bearer(req);
  if (!token) throw new HttpError(401, "Sign in required", "UNAUTHENTICATED");
  try {
    return (await verifyPrivyToken(token)).privyUserId;
  } catch {
    throw new HttpError(401, "Session expired. Sign in again.", "UNAUTHENTICATED");
  }
}

/** Resolves the caller from a verified Privy token. The profile mapping is server-side only. */
export async function requireUser(req: NextRequest, opts: { allowBanned?: boolean } = {}): Promise<Caller> {
  const privyUserId = await verifiedPrivyId(req);
  const row = must(
    await db()
      .from("profile_private")
      .select("profile_id, profiles!inner(id, username, display_name, bio, avatar_url, role, is_banned, onboarded_at)")
      .eq("privy_user_id", privyUserId)
      .maybeSingle(),
  ) as unknown as { profile_id: string; profiles: Profile } | null;
  if (!row) throw new HttpError(401, "Finish signing up first.", "NO_PROFILE");
  if (row.profiles.is_banned && !opts.allowBanned) throw forbidden("This account is suspended.");
  const wallet = must(
    await db()
      .from("linked_wallets")
      .select("address")
      .eq("profile_id", row.profile_id)
      .eq("network", env().STELLAR_NETWORK)
      .eq("is_primary", true)
      .maybeSingle(),
  ) as { address: string } | null;
  return { profile: row.profiles, privyUserId, wallet: wallet?.address ?? null };
}

export async function optionalUser(req: NextRequest): Promise<Caller | null> {
  if (!bearer(req)) return null;
  try {
    return await requireUser(req);
  } catch {
    return null;
  }
}

export function requireWallet(c: Caller): string {
  if (!c.wallet) throw new HttpError(409, "Create your Stellar wallet first.", "NO_WALLET");
  return c.wallet;
}

export function requireRole(c: Caller, ...roles: Profile["role"][]) {
  if (!roles.includes(c.profile.role)) throw forbidden();
}

export async function walletOf(profileId: string): Promise<string | null> {
  const r = must(
    await db().from("linked_wallets").select("address").eq("profile_id", profileId).eq("network", env().STELLAR_NETWORK).eq("is_primary", true).maybeSingle(),
  ) as { address: string } | null;
  return r?.address ?? null;
}
