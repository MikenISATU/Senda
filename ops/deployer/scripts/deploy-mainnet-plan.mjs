#!/usr/bin/env node
// MAINNET IS GATED. This script never signs or submits anything.
// It prints the checklist and the exact commands a human operator must run
// with a hardware-backed / multisig identity after written approval.
const checklist = [
  "Independent security audit of job_escrow completed; findings fixed; report linked in release notes",
  "Testnet manifest verified (node ops/deployer/scripts/verify.mjs) on the exact commit being released",
  "Full E2E run on testnet: fund, proof, revision, approve, refund, dispute/resolve, stale dispute",
  "Mainnet admin is a multisig account (e.g. 2-of-3) held on hardware wallets; guardian and mediator are separate keys",
  "Mainnet USDC issuer confirmed from Circle's official docs (NOT the testnet issuer)",
  "Legal review of escrow, fees, mediation terms and money-transmission requirements in each launch market",
  "Faucet disabled (FAUCET_ENABLED=false) and USDC_AUTO_EARN_ENABLED=false unless separately approved",
  "Rollback plan rehearsed: guardian pause (blocks new funding), exits remain open, upgrade timelock 48h",
  "Written sign-off from the project owner recorded with date and commit hash",
];
console.log("SENDA MAINNET DEPLOYMENT PLAN (dry run, nothing will be executed)\n");
checklist.forEach((c, i) => console.log(`[ ] ${i + 1}. ${c}`));
console.log(`
Commands for the operator (run manually, after every box is ticked):

  stellar network use mainnet
  stellar contract build
  sha256sum contracts/target/wasm32v1-none/release/job_escrow.wasm   # must equal the audited hash
  stellar contract upload --wasm contracts/target/wasm32v1-none/release/job_escrow.wasm --source <MAINNET_MULTISIG_SIGNER> --network mainnet
  stellar contract deploy --wasm-hash <HASH> --source <MAINNET_MULTISIG_SIGNER> --network mainnet -- \\
    --admin <MULTISIG_G_ADDRESS> --guardian <GUARDIAN_G> --mediator <MEDIATOR_G> --fee_collector <TREASURY_G> \\
    --fee_bps 250 --review_period 604800 --allowed_tokens '["<MAINNET_USDC_SAC>"]'

Record a manifest under ops/deployer/manifests/mainnet-<date>.json with the same fields as the testnet manifest.
`);
