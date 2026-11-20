// Shared helpers for Senda deployer scripts. Never prints or stores secret keys.
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const DEPLOYER_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const REPO_ROOT = resolve(DEPLOYER_DIR, "..", "..");
export const CONTRACTS_DIR = join(REPO_ROOT, "contracts");
export const MANIFEST_DIR = join(DEPLOYER_DIR, "manifests");
export const TESTNET_PASSPHRASE = "Test SDF Network ; September 2015";

export function loadEnv() {
  const file = join(DEPLOYER_DIR, ".env");
  const env = { ...process.env };
  if (existsSync(file)) {
    for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      if (/SECRET|SEED|PRIVATE/i.test(m[1])) {
        throw new Error(`Refusing to read ${m[1]} from ops/deployer/.env. Keep secrets in the Stellar CLI identity store.`);
      }
      if (env[m[1]] === undefined) env[m[1]] = m[2].replace(/^"|"$/g, "");
    }
  }
  return env;
}

/** Runs the stellar CLI. Returns { stdout, stderr }. Throws on failure. */
export function stellar(args, opts = {}) {
  const r = spawnSync("stellar", args, {
    cwd: opts.cwd ?? REPO_ROOT,
    encoding: "utf8",
    shell: process.platform === "win32",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (r.error) throw new Error(`Could not run the stellar CLI: ${r.error.message}`);
  if (r.status !== 0 && !opts.allowFail) {
    throw new Error(`stellar ${args.slice(0, 3).join(" ")} failed:\n${r.stderr || r.stdout}`);
  }
  return { stdout: (r.stdout || "").trim(), stderr: (r.stderr || "").trim(), status: r.status };
}

export function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

export function txHashFrom(text) {
  const m = text.match(/transaction hash is ([0-9a-f]{64})/i) || text.match(/\b([0-9a-f]{64})\b/);
  return m ? m[1] : null;
}

export function gitCommit() {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: REPO_ROOT, encoding: "utf8" }).trim();
  } catch {
    return "uncommitted";
  }
}

export function latestManifest(network = "testnet") {
  if (!existsSync(MANIFEST_DIR)) return null;
  const files = readdirSync(MANIFEST_DIR).filter((f) => f.startsWith(`${network}-`) && f.endsWith(".json")).sort();
  if (!files.length) return null;
  const path = join(MANIFEST_DIR, files[files.length - 1]);
  return { path, data: JSON.parse(readFileSync(path, "utf8")) };
}

export function step(msg) {
  console.log(`\n==> ${msg}`);
}
