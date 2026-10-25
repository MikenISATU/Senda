import "server-only";
import { z } from "zod";

/**
 * Server-only configuration. Never import this from a client component:
 * the `server-only` import makes the build fail if you do.
 */
const optional = z.string().trim().optional().transform((v) => (v ? v : undefined));
const bool = (d: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === "" ? d : v === "true"));
const num = (d: number) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === "" ? d : Number(v)))
    .pipe(z.number().finite().nonnegative());

const schema = z.object({
  NEXT_PUBLIC_APP_URL: z.string().url().default("http://localhost:3000"),
  STELLAR_NETWORK: z.enum(["testnet", "mainnet"]).default("testnet"),
  STELLAR_RPC_URL: optional,
  STELLAR_HORIZON_URL: optional,
  STELLAR_NETWORK_PASSPHRASE: optional,
  STELLAR_USDC_ISSUER: optional,
  STELLAR_USDC_ASSET_CONTRACT_ID: optional,
  STELLAR_XLM_ASSET_CONTRACT_ID: optional,

  NEXT_PUBLIC_SUPABASE_URL: optional,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: optional,
  SUPABASE_SERVICE_ROLE_KEY: optional,
  SUPABASE_JWT_SECRET: optional,

  NEXT_PUBLIC_PRIVY_APP_ID: optional,
  PRIVY_APP_SECRET: optional,
  PRIVY_AUTH_VERIFICATION_CONFIG: optional,

  PAIFLOW_API_BASE_URL: z.string().url().default("https://beta.app.paiflow.xyz"),
  PAIFLOW_API_KEY: optional,
  PAIFLOW_FEES_USDC_WORKFLOW_ID: optional,
  PAIFLOW_FEES_XLM_WORKFLOW_ID: optional,
  PAIFLOW_SEND_WORKFLOW_ID: optional,
  PAIFLOW_RECEIVE_WORKFLOW_ID: optional,
  PAIFLOW_TIP_WORKFLOW_ID: optional,
  PAIFLOW_POST_PURCHASE_WORKFLOW_ID: optional,
  PAIFLOW_JOB_FUND_WORKFLOW_ID: optional,
  PAIFLOW_WEBHOOK_SIGNING_SECRET: optional,

  SOROBAN_JOB_ESCROW_CONTRACT_ID: optional,
  SOROBAN_USDC_EARN_VAULT_CONTRACT_ID: optional,
  SOROBAN_YIELD_STRATEGY_CONTRACT_ID: optional,
  EARN_ASSET_CONTRACT_ID: optional,
  FEE_COLLECTOR_ADDRESS: optional,
  TREASURY_PUBLIC_ADDRESS: optional,
  PLATFORM_FEE_BPS: num(250),

  USDC_AUTO_EARN_ENABLED: bool(false),
  EARN_VAULT_AUDITED: bool(false),
  USDC_TARGET_APR_DISPLAY: num(0.05),

  FAUCET_ENABLED: bool(true),
  FAUCET_TREASURY_SECRET: optional,
  FAUCET_XLM_NEW_USER_AMOUNT: num(0),
  FAUCET_USDC_NEW_USER_AMOUNT: num(5),
  FAUCET_XLM_CLAIM_AMOUNT: num(20),
  FAUCET_USDC_CLAIM_AMOUNT: num(2),
  FAUCET_CLAIM_COOLDOWN_HOURS: num(24),
  FAUCET_DAILY_TREASURY_CAP: num(500),
  FAUCET_MAX_CLAIMS_PER_IP_PER_DAY: num(3),

  CRON_SECRET: optional,
  IP_HASH_SALT: optional,
});

export type ServerEnv = z.infer<typeof schema>;

let cached: ServerEnv | null = null;
export function env(): ServerEnv {
  if (!cached) cached = schema.parse(process.env);
  return cached;
}

export class ConfigError extends Error {
  constructor(public missing: string[]) {
    super(`Missing configuration: ${missing.join(", ")}. See docs/ENV_SETUP.md.`);
  }
}

/** Throws a ConfigError (rendered as a 503 with setup guidance) if any key is unset. */
export function requireEnv<K extends keyof ServerEnv>(...keys: K[]): { [P in K]: NonNullable<ServerEnv[P]> } {
  const e = env();
  const missing = keys.filter((k) => e[k] === undefined || e[k] === "");
  if (missing.length) throw new ConfigError(missing as string[]);
  return e as { [P in K]: NonNullable<ServerEnv[P]> };
}
