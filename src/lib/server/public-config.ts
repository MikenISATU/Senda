import "server-only";
import { earnConfig } from "./earn";
import { env } from "./env";
import { feeConfig } from "./fees";

/** Non-secret feature flags the UI needs. Never include keys or ids that grant access. */
export async function publicConfig() {
  const e = env();
  let earn: { enabled: boolean; experimental: boolean; reason: string | null } = { enabled: false, experimental: true, reason: "Not configured" };
  try {
    const c = earnConfig();
    earn = { enabled: c.enabled, experimental: c.experimental, reason: c.reason };
  } catch {
    /* network misconfigured: earn stays off */
  }
  // Fee rates come from the fee splitter contract. No contract (or paused) means no Senda fee.
  const fees = await feeConfig();
  const live = !!fees && !fees.paused;
  return {
    network: e.STELLAR_NETWORK,
    faucetEnabled: e.STELLAR_NETWORK === "testnet" && e.FAUCET_ENABLED,
    escrowConfigured: !!e.SOROBAN_JOB_ESCROW_CONTRACT_ID,
    platformFeeBps: live ? fees.platformBps : 0,
    sendFeeBps: live ? fees.sendBps : 0,
    targetAprDisplay: e.USDC_TARGET_APR_DISPLAY,
    earn,
    realtime: !!e.SUPABASE_JWT_SECRET,
  };
}
