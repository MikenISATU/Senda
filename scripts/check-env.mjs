#!/usr/bin/env node
// Checks .env.local for missing or misplaced values without printing secrets.
import { existsSync, readFileSync } from "node:fs";

const file = existsSync(".env.local") ? ".env.local" : null;
if (!file) {
  console.error("No .env.local found. Copy .env.example to .env.local first (see docs/ENV_SETUP.md).");
  process.exit(1);
}
const env = Object.fromEntries(
  readFileSync(file, "utf8").split(/\r?\n/).map((l) => l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)).filter(Boolean).map((m) => [m[1], m[2].replace(/^"|"$/g, "")]),
);
const groups = {
  "Required to run": ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY", "NEXT_PUBLIC_PRIVY_APP_ID", "PRIVY_APP_SECRET"],
  "Recommended": ["SUPABASE_JWT_SECRET", "CRON_SECRET", "IP_HASH_SALT"],
  "Jobs / escrow": ["SOROBAN_JOB_ESCROW_CONTRACT_ID"],
  "Faucet (testnet)": ["FAUCET_TREASURY_SECRET", "TREASURY_PUBLIC_ADDRESS"],
  "Fees": ["FEE_COLLECTOR_ADDRESS"],
  "Paiflow (optional)": ["PAIFLOW_API_KEY", "PAIFLOW_FEES_USDC_WORKFLOW_ID", "PAIFLOW_FEES_XLM_WORKFLOW_ID"],
  "Earn (optional, off by default)": ["SOROBAN_YIELD_STRATEGY_CONTRACT_ID"],
};
let bad = false;
for (const [g, keys] of Object.entries(groups)) {
  console.log(`\n${g}`);
  for (const k of keys) console.log(`  ${env[k] ? "OK     " : "missing"} ${k}`);
  if (g === "Required to run" && keys.some((k) => !env[k])) bad = true;
}
const problems = [];
for (const [k, v] of Object.entries(env)) {
  if (k.startsWith("NEXT_PUBLIC_") && /^S[A-Z2-7]{55}$/.test(v)) problems.push(`${k} looks like a Stellar SECRET key but is public. Remove it.`);
  if (k.startsWith("NEXT_PUBLIC_") && /(pfd|pfk)_[a-f0-9]{64}/.test(v)) problems.push(`${k} contains a Paiflow token but is public. Remove it.`);
  if (k.startsWith("NEXT_PUBLIC_") && /SECRET|SERVICE_ROLE/.test(k)) problems.push(`${k}: secrets must never use the NEXT_PUBLIC_ prefix.`);
}
if (env.STELLAR_NETWORK === "mainnet" && env.FAUCET_ENABLED !== "false") problems.push("FAUCET_ENABLED must be false on mainnet.");
if (env.PAIFLOW_API_KEY && !/^(pfd|pfk)_[a-f0-9]{64}$/.test(env.PAIFLOW_API_KEY)) problems.push("PAIFLOW_API_KEY should be pfd_ or pfk_ followed by 64 hex characters.");
if (env.FAUCET_TREASURY_SECRET && !/^S[A-Z2-7]{55}$/.test(env.FAUCET_TREASURY_SECRET)) problems.push("FAUCET_TREASURY_SECRET should start with S and be 56 characters.");
if (problems.length) {
  console.log("\nProblems:");
  problems.forEach((p) => console.log(`  - ${p}`));
  bad = true;
}
console.log(bad ? "\nFix the items above, then run `pnpm dev`." : "\nLooks good. Run `pnpm dev`, then open http://localhost:3000/api/health");
process.exit(bad ? 1 : 0);
