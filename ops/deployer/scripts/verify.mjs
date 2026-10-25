#!/usr/bin/env node
// Verifies the latest testnet manifest against the live network:
// on-chain wasm matches the recorded sha256, and get_config is readable.
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { DEPLOYER_DIR, latestManifest, loadEnv, sha256File, stellar, step } from "./lib.mjs";

const env = loadEnv();
const m = latestManifest("testnet");
if (!m) {
  console.error("No testnet manifest found in ops/deployer/manifests. Deploy first.");
  process.exit(1);
}
console.log(`Manifest: ${m.path}`);
const IDENT = env.SENDA_TESTNET_IDENTITY || "senda-testnet-deployer";
const tmp = join(DEPLOYER_DIR, "tmp");
mkdirSync(tmp, { recursive: true });
let ok = true;

for (const [name, c] of Object.entries(m.data.contracts)) {
  step(`${name} ${c.contractId}`);
  const out = join(tmp, `${name}.wasm`);
  stellar(["contract", "fetch", "--id", c.contractId, "--network", "testnet", "--out-file", out]);
  const sha = sha256File(out);
  const match = sha === c.wasmSha256;
  ok &&= match;
  console.log(`on-chain wasm sha256 ${sha} ${match ? "MATCHES manifest" : "DOES NOT MATCH manifest"}`);
  const fn = name === "job_escrow" ? "get_config" : "config";
  const r = stellar(["contract", "invoke", "--id", c.contractId, "--source", IDENT, "--network", "testnet", "--send=no", "--", fn], { allowFail: true });
  console.log(r.status === 0 ? `${fn}: ${r.stdout}` : `${fn} read failed: ${r.stderr}`);
  ok &&= r.status === 0;
  if (name === "job_escrow") {
    for (const [code, id] of [["XLM", m.data.assets.XLM_SAC], ["USDC", m.data.assets.USDC_SAC]]) {
      const a = stellar(["contract", "invoke", "--id", c.contractId, "--source", IDENT, "--network", "testnet", "--send=no", "--", "is_token_allowed", "--token", id], { allowFail: true });
      console.log(`${code} allowed: ${a.stdout}`);
    }
  }
}
rmSync(tmp, { recursive: true, force: true });
console.log(ok ? "\nVERIFIED" : "\nVERIFICATION FAILED");
process.exit(ok ? 0 : 1);
