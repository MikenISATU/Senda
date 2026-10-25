import "server-only";
import { earnConfig } from "./earn";
import { env } from "./env";
import { workflowId } from "./paiflow";

/** Non-secret feature flags the UI needs. Never include keys or ids that grant access. */
export function publicConfig() {
  const e = env();
  let earn: { enabled: boolean; experimental: boolean; reason: string | null } = { enabled: false, experimental: true, reason: "Not configured" };
  try {
    const c = earnConfig();
    earn = { enabled: c.enabled, experimental: c.experimental, reason: c.reason };
  } catch {
    /* network misconfigured: earn stays off */
  }
  return {
    network: e.STELLAR_NETWORK,
    faucetEnabled: e.STELLAR_NETWORK === "testnet" && e.FAUCET_ENABLED,
    escrowConfigured: !!e.SOROBAN_JOB_ESCROW_CONTRACT_ID,
    platformFeeBps: e.PLATFORM_FEE_BPS,
    targetAprDisplay: e.USDC_TARGET_APR_DISPLAY,
    earn,
    paiflow: {
      configured: !!e.PAIFLOW_API_KEY,
      feesUsdc: !!workflowId("FEES_USDC"),
      feesXlm: !!workflowId("FEES_XLM"),
    },
    realtime: !!e.SUPABASE_JWT_SECRET,
  };
}
