#!/usr/bin/env node
// Senda TESTNET deployment. Builds, tests, uploads and deploys job_escrow
// (and optionally the experimental earn vault), then writes a manifest.
// The deployer secret stays inside the Stellar CLI identity store.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import {
  CONTRACTS_DIR, MANIFEST_DIR, TESTNET_PASSPHRASE, gitCommit, loadEnv, sha256File, stellar, step, txHashFrom,
} from "./lib.mjs";

const env = loadEnv();
const NETWORK = env.STELLAR_NETWORK || "testnet";
if (NETWORK !== "testnet") {
  console.error("This script deploys to TESTNET only. Mainnet uses deploy-mainnet-plan.mjs (dry run + manual approval).");
  process.exit(1);
}
const IDENT = env.SENDA_TESTNET_IDENTITY || "senda-testnet-deployer";
const USDC_ISSUER = env.USDC_ISSUER || "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";

step("Checking Stellar CLI");
console.log(stellar(["--version"]).stdout.split("\n")[0]);

step(`Resolving deployer identity "${IDENT}" (public key only)`);
const addr = stellar(["keys", "address", IDENT], { allowFail: true });
if (addr.status !== 0 || !/^G[A-Z2-7]{55}$/.test(addr.stdout)) {
  console.error(`\nIdentity "${IDENT}" not found. Create it once (secret stays in your OS keychain):\n\n  stellar keys generate ${IDENT} --network testnet --fund --secure-store\n\nIf your CLI version lacks --secure-store, omit it (the key is then stored in the CLI config folder, never in this repo).`);
  process.exit(1);
}
const DEPLOYER = addr.stdout;
console.log(`Deployer: ${DEPLOYER}`);
const GUARDIAN = env.ESCROW_GUARDIAN || DEPLOYER;
const MEDIATOR = env.ESCROW_MEDIATOR || DEPLOYER;
const FEE_COLLECTOR = env.FEE_COLLECTOR_ADDRESS || DEPLOYER;
const FEE_BPS = env.ESCROW_FEE_BPS || "250";
const REVIEW = env.ESCROW_REVIEW_PERIOD || "604800";

step("Running contract tests (cargo test)");
const t = spawnSync("cargo", ["test", "--quiet"], { cwd: CONTRACTS_DIR, stdio: "inherit", shell: process.platform === "win32" });
if (t.status !== 0) {
  console.error("Contract tests failed. Not deploying.");
  process.exit(1);
}

step("Building wasm (stellar contract build)");
stellar(["contract", "build"], { cwd: CONTRACTS_DIR });
const wasmDir = join(CONTRACTS_DIR, "target", "wasm32v1-none", "release");
const escrowWasm = join(wasmDir, "job_escrow.wasm");
const escrowSha = sha256File(escrowWasm);
console.log(`job_escrow.wasm sha256 ${escrowSha}`);

step("Resolving asset contracts (Stellar Asset Contracts)");
const assets = { XLM: "native", USDC: `USDC:${USDC_ISSUER}` };
const sac = {};
for (const [code, asset] of Object.entries(assets)) {
  // Deploy the SAC if it does not exist yet; ignore "already exists".
  stellar(["contract", "asset", "deploy", "--asset", asset, "--source", IDENT, "--network", "testnet"], { allowFail: true });
  sac[code] = stellar(["contract", "id", "asset", "--asset", asset, "--network", "testnet"]).stdout;
  console.log(`${code} SAC: ${sac[code]}`);
}

step("Uploading job_escrow wasm");
const up = stellar(["contract", "upload", "--wasm", escrowWasm, "--source", IDENT, "--network", "testnet"]);
const wasmHash = up.stdout.split(/\s+/).pop();
const uploadTx = txHashFrom(up.stderr);
console.log(`wasm hash ${wasmHash}`);

step("Deploying job_escrow");
const dep = stellar([
  "contract", "deploy", "--wasm-hash", wasmHash, "--source", IDENT, "--network", "testnet", "--alias", "senda_job_escrow",
  "--",
  "--admin", DEPLOYER, "--guardian", GUARDIAN, "--mediator", MEDIATOR, "--fee_collector", FEE_COLLECTOR,
  "--fee_bps", FEE_BPS, "--review_period", REVIEW, "--allowed_tokens", JSON.stringify([sac.XLM, sac.USDC]),
]);
const escrowId = dep.stdout.split(/\s+/).pop();
const deployTx = txHashFrom(dep.stderr);
console.log(`job_escrow: ${escrowId}`);

const contracts = {
  job_escrow: {
    contractId: escrowId, wasmSha256: escrowSha, wasmHash, uploadTx, deployTx,
    explorer: `https://stellar.expert/explorer/testnet/contract/${escrowId}`,
    constructor: { admin: DEPLOYER, guardian: GUARDIAN, mediator: MEDIATOR, fee_collector: FEE_COLLECTOR, fee_bps: Number(FEE_BPS), review_period: Number(REVIEW), allowed_tokens: [sac.XLM, sac.USDC] },
    permissions: "admin: config/upgrade (48h timelock); guardian: pause new funding; mediator: split disputed escrow between parties only",
  },
};

if (env.DEPLOY_EARN_VAULT === "true") {
  // Defaults: Blend v2 "TestnetV2" pool + Blend testnet USDC (blend-utils testnet.contracts.json).
  env.EARN_BLEND_POOL_ID ||= "CCEBVDYM32YNYCVNRXQKDFFPISJJCV557CDZEIRBEE4NCV4KHPQ44HGF";
  env.EARN_ASSET_CONTRACT_ID ||= "CAQCFVLOBK5GIULPNZRGATJJMIZL5BSP7X5YJVMGCPTUEPFM4AVSRCJU";
  // Sanity check that the pool lists this asset before deploying anything that points at it.
  const chk = stellar(["contract", "invoke", "--id", env.EARN_BLEND_POOL_ID, "--source", IDENT, "--network", "testnet", "--send=no", "--", "get_reserve", "--asset", env.EARN_ASSET_CONTRACT_ID], { allowFail: true });
  if (chk.status !== 0) {
    console.error(`The Blend pool ${env.EARN_BLEND_POOL_ID} did not return a reserve for ${env.EARN_ASSET_CONTRACT_ID}. Set EARN_BLEND_POOL_ID / EARN_ASSET_CONTRACT_ID to a current Blend testnet pool.\n${chk.stderr}`);
    process.exit(1);
  }
  step("Deploying EXPERIMENTAL usdc_earn_vault (unaudited, testnet only)");
  const vaultWasm = join(wasmDir, "usdc_earn_vault.wasm");
  const vup = stellar(["contract", "upload", "--wasm", vaultWasm, "--source", IDENT, "--network", "testnet"]);
  const vHash = vup.stdout.split(/\s+/).pop();
  const vdep = stellar([
    "contract", "deploy", "--wasm-hash", vHash, "--source", IDENT, "--network", "testnet", "--alias", "senda_earn_vault",
    "--", "--admin", DEPLOYER, "--guardian", GUARDIAN, "--asset", env.EARN_ASSET_CONTRACT_ID,
    "--strategy", env.EARN_BLEND_POOL_ID, "--deposit_cap", env.EARN_DEPOSIT_CAP_STROOPS || "10000000000",
  ]);
  const vaultId = vdep.stdout.split(/\s+/).pop();
  contracts.usdc_earn_vault = {
    contractId: vaultId, wasmSha256: sha256File(vaultWasm), wasmHash: vHash,
    uploadTx: txHashFrom(vup.stderr), deployTx: txHashFrom(vdep.stderr), audited: false,
    strategy: env.EARN_BLEND_POOL_ID, asset: env.EARN_ASSET_CONTRACT_ID,
  };
}

const now = new Date();
const manifest = {
  release: "senda-contracts-0.1.0",
  network: "testnet",
  networkPassphrase: TESTNET_PASSPHRASE,
  deployerPublicKey: DEPLOYER,
  sourceCommit: gitCommit(),
  deployedAt: now.toISOString(),
  assets: { XLM_SAC: sac.XLM, USDC_SAC: sac.USDC, USDC_ISSUER },
  contracts,
};
mkdirSync(MANIFEST_DIR, { recursive: true });
const file = join(MANIFEST_DIR, `testnet-${now.toISOString().replace(/[:.]/g, "-")}.json`);
writeFileSync(file, JSON.stringify(manifest, null, 2) + "\n");

step("Done");
console.log(`Manifest: ${file}`);
console.log("\nPaste these into your app's .env.local:\n");
console.log(`SOROBAN_JOB_ESCROW_CONTRACT_ID=${escrowId}`);
console.log(`STELLAR_USDC_ASSET_CONTRACT_ID=${sac.USDC}`);
console.log(`STELLAR_XLM_ASSET_CONTRACT_ID=${sac.XLM}`);
if (contracts.usdc_earn_vault) {
  console.log(`SOROBAN_USDC_EARN_VAULT_CONTRACT_ID=${contracts.usdc_earn_vault.contractId}`);
  console.log(`SOROBAN_YIELD_STRATEGY_CONTRACT_ID=${contracts.usdc_earn_vault.strategy}`);
  console.log(`EARN_ASSET_CONTRACT_ID=${contracts.usdc_earn_vault.asset}`);
  console.log(`USDC_AUTO_EARN_ENABLED=true`);
}
console.log(`\nVerify with: node ops/deployer/scripts/verify.mjs`);
