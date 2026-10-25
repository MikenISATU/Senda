import "server-only";
import { StrKey } from "@stellar/stellar-sdk";
import { env } from "./env";
import { bad, notFound } from "./http";
import { db } from "./supabase";

export type Recipient = { address: string; profileId: string | null; username: string | null };

/** Resolves "@handle", "handle" or a G... address. Handles map only to verified linked wallets. */
export async function resolveRecipient(input: string): Promise<Recipient> {
  const v = input.trim();
  if (/^G[A-Z2-7]{55}$/.test(v)) {
    if (!StrKey.isValidEd25519PublicKey(v)) throw bad("That Stellar address has an invalid checksum.");
    const { data } = await db().from("linked_wallets").select("profile_id, profiles!inner(username)").eq("address", v).eq("network", env().STELLAR_NETWORK).maybeSingle();
    const row = data as unknown as { profile_id: string; profiles: { username: string | null } } | null;
    return { address: v, profileId: row?.profile_id ?? null, username: row?.profiles.username ?? null };
  }
  const handle = v.replace(/^@/, "").toLowerCase();
  if (!/^[a-z0-9_]{3,20}$/.test(handle)) throw bad("Enter a @username or a Stellar G... address.");
  const { data } = await db()
    .from("profiles")
    .select("id, username, is_banned, linked_wallets!inner(address, network, is_primary)")
    .eq("username", handle)
    .eq("linked_wallets.network", env().STELLAR_NETWORK)
    .eq("linked_wallets.is_primary", true)
    .maybeSingle();
  const p = data as unknown as { id: string; username: string; is_banned: boolean; linked_wallets: { address: string }[] } | null;
  if (!p || p.is_banned || !p.linked_wallets?.[0]) throw notFound(`@${handle} has no Senda wallet yet.`);
  return { address: p.linked_wallets[0].address, profileId: p.id, username: p.username };
}
