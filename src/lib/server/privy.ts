import "server-only";
import { PrivyClient } from "@privy-io/node";
import { requireEnv } from "./env";

let client: PrivyClient | null = null;

export function privy(): PrivyClient {
  if (!client) {
    const e = requireEnv("NEXT_PUBLIC_PRIVY_APP_ID", "PRIVY_APP_SECRET");
    client = new PrivyClient({
      appId: e.NEXT_PUBLIC_PRIVY_APP_ID,
      appSecret: e.PRIVY_APP_SECRET,
      // Verification key from Privy dashboard > Configuration > App settings.
      // Lets us verify tokens locally without a network call per request.
      ...(process.env.PRIVY_AUTH_VERIFICATION_CONFIG
        ? { jwtVerificationKey: process.env.PRIVY_AUTH_VERIFICATION_CONFIG.replace(/\\n/g, "\n") }
        : {}),
    });
  }
  return client;
}

export type VerifiedPrivy = { privyUserId: string; sessionId: string };

/** Verifies a Privy access token (signature, audience = our app, expiry). */
export async function verifyPrivyToken(token: string): Promise<VerifiedPrivy> {
  const claims = await privy().utils().auth().verifyAccessToken(token);
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;
  if (claims.app_id && appId && claims.app_id !== appId) throw new Error("Token issued for another app");
  return { privyUserId: claims.user_id, sessionId: claims.session_id };
}

export type PrivyIdentity = { email: string | null; stellarWallets: { address: string; walletId: string | null }[] };

/** Fetches the user from Privy's API (source of truth for email + embedded wallets). */
export async function getPrivyIdentity(privyUserId: string): Promise<PrivyIdentity> {
  const user = await privy().users()._get(privyUserId);
  let email: string | null = null;
  const stellarWallets: PrivyIdentity["stellarWallets"] = [];
  for (const a of user.linked_accounts as unknown as Array<Record<string, unknown>>) {
    if (a.type === "email" && typeof a.address === "string") email = a.address;
    if (a.type === "wallet" && a.chain_type === "stellar" && typeof a.address === "string") {
      stellarWallets.push({ address: a.address, walletId: (a.id as string | null) ?? null });
    }
  }
  return { email, stellarWallets };
}
