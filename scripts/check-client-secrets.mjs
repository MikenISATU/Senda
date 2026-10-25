#!/usr/bin/env node
// After `pnpm build`, scans the browser bundles for anything that looks like a secret.
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";

const dir = ".next/static";
if (!existsSync(dir)) {
  console.error("Run `pnpm build` first.");
  process.exit(1);
}
const patterns = [
  [/\bS[A-Z2-7]{55}\b/, "Stellar secret key"],
  [/\b(pfd|pfk)_[a-f0-9]{64}\b/, "Paiflow token"],
  [/service_role/, "Supabase service role reference"],
  [/sb_secret_[A-Za-z0-9_-]{10,}/, "Supabase secret key"],
  [/PRIVY_APP_SECRET|FAUCET_TREASURY_SECRET|SUPABASE_JWT_SECRET|CRON_SECRET/, "server env var name"],
];
let hits = 0;
const walk = (d) => {
  for (const f of readdirSync(d)) {
    const p = join(d, f);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(js|css|html|json)$/.test(f)) {
      const s = readFileSync(p, "utf8");
      for (const [re, name] of patterns) if (re.test(s)) { console.log(`FOUND ${name} in ${p}`); hits++; }
    }
  }
};
walk(dir);
console.log(hits ? `\n${hits} potential leak(s).` : "No secrets found in client bundles.");
process.exit(hits ? 1 : 0);
