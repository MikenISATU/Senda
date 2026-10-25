import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SignJWT } from "jose";
import { env, requireEnv } from "./env";
import { supabaseOrigin } from "../supabaseUrl";

let admin: SupabaseClient | null = null;

/** Service-role client. Bypasses RLS: only use after verifying the caller. */
export function db(): SupabaseClient {
  if (!admin) {
    const e = requireEnv("NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY");
    admin = createClient(supabaseOrigin(e.NEXT_PUBLIC_SUPABASE_URL), e.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return admin;
}

/** Throws on Supabase errors so routes never act on partial data. */
export function must<T>(r: { data: T; error: { message: string; code?: string } | null }): T {
  if (r.error) throw new DbError(r.error.message, r.error.code);
  return r.data;
}

export class DbError extends Error {
  constructor(message: string, public code?: string) {
    super(message);
  }
}

/**
 * Mints a short-lived Supabase JWT for read access under RLS (realtime chat,
 * notifications). `sub` is the Senda profile id derived from a VERIFIED Privy
 * token, never from client input. Returns null if not configured; the app
 * then falls back to polling through authenticated API routes.
 */
export async function mintSupabaseToken(profileId: string): Promise<{ token: string; expiresAt: number } | null> {
  const secret = env().SUPABASE_JWT_SECRET;
  if (!secret) return null;
  const exp = Math.floor(Date.now() / 1000) + 60 * 60;
  const token = await new SignJWT({ role: "authenticated" })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(profileId)
    .setAudience("authenticated")
    .setIssuedAt()
    .setExpirationTime(exp)
    .sign(new TextEncoder().encode(secret));
  return { token, expiresAt: exp * 1000 };
}

export const PUBLIC_PROFILE_FIELDS = "id, username, display_name, bio, avatar_url, follower_count, following_count, role, created_at";
