# Start here

This guide takes you from an empty computer to Senda running locally on Stellar testnet, then deployed on Vercel. Commands are for **Windows PowerShell** (they also work in the VS Code terminal). Do the sections in order. Each one ends with a check so you know it worked.

What's already done for you: all app code, database migrations, smart contracts with tests, deploy scripts and docs. What only you can do: create accounts (Supabase, Privy, Paiflow, Vercel), copy their keys into `.env.local`, and run the contract deployment (it needs your own deployer key). The live status of every item is in `docs/CHECKLIST.md`.

---

## 1. Required software

| Tool | Version | Install | Check |
|---|---|---|---|
| Node.js | 22.12 or newer (24 works) | nodejs.org, LTS installer | `node -v` |
| pnpm | 10.x | `npm install -g pnpm@10` | `pnpm -v` |
| Git | any recent | git-scm.com | `git --version` |
| VS Code | any recent | code.visualstudio.com | |
| Rust | stable (1.85+) | rustup.rs (`rustup-init.exe`). On Windows it also asks for **Visual Studio C++ Build Tools**: accept | `rustc --version` |
| Wasm target | | `rustup target add wasm32v1-none` | `rustup target list --installed` |
| Stellar CLI | 23 or newer | `winget install --id Stellar.StellarCLI` or, if that fails, `cargo install --locked stellar-cli` (takes ~10 min) | `stellar --version` |

Close and reopen PowerShell after installing so new commands are found.

## 2. Open the project in VS Code

1. Open VS Code > **File > Open Folder** > choose `D:\Senda` > **Select Folder**. Trust the authors when asked.
2. VS Code offers recommended extensions (Tailwind, Rust Analyzer, Playwright, Vitest). Click **Install All**.
3. Open a terminal: **Terminal > New Terminal** (or `` Ctrl+` ``). It opens in `D:\Senda`.

## 3. Install dependencies

```powershell
pnpm install
```
If pnpm prints "Ignored build scripts", that's expected and safe. For the browser tests later, also run `pnpm exec playwright install chromium` once.

**Check:** `pnpm test` should finish with `24 passed`.

## 4. Configure Supabase (database, file storage, realtime)

1. Go to supabase.com > **New project**. Pick a name (`senda`), a strong database password (store it in your password manager), and a region close to your users (e.g. Singapore). Wait for it to finish.
2. Open **SQL Editor** > **New query**. Open `supabase/RUN_THIS_IN_SUPABASE.sql` in VS Code, select all (`Ctrl+A`), copy, paste into the editor, click **Run**. It should say "Success. No rows returned". Run it only once on a fresh project. (It is the three files in `supabase/migrations/` combined; you can run those one by one in order instead.)
3. Open **Project Settings > API** (or the **Connect** button). Copy:
   - Project URL > `NEXT_PUBLIC_SUPABASE_URL`
   - anon / publishable key > `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - service_role / secret key > `SUPABASE_SERVICE_ROLE_KEY` (secret!)
4. Open **Project Settings > JWT Keys** and copy the **Legacy JWT secret** > `SUPABASE_JWT_SECRET` (enables instant chat; optional).

**Check:** **Storage** shows four buckets (`public-media`, `premium-media`, `chat-attachments`, `avatars`), and **Table Editor** lists `profiles`, `posts`, `jobs` and the rest, each marked RLS enabled.

## 5. Configure Privy (email sign-in and Stellar wallets)

1. Go to dashboard.privy.io > **Create app** (type: web). Name it `Senda`.
2. **Login methods**: enable **Email**. Turn off everything else for now.
3. **Configuration > App settings > Domains** (allowed origins): add `http://localhost:3000`. You'll add your Vercel URL in section 12.
4. **Embedded wallets**: Senda creates a **Stellar** wallet for each user from code (`createWallet({ chainType: "stellar" })`). If your dashboard shows a setting for extended chains or Stellar, enable it.
5. **Configuration > App settings > Basics**: copy **App ID** > `NEXT_PUBLIC_PRIVY_APP_ID` and **App secret** > `PRIVY_APP_SECRET` (secret; it's only shown once, so create a new one if needed).

## 6. Build the Paiflow workflows

Full click-by-click guide: **docs/PAIFLOW_SETUP.md**. Short version:
- Sends, chat requests, tips, paid posts and job payments don't use Paiflow (Paiflow flows have fixed recipients). They are direct payments, or the job escrow contract.
- Build **two** flows, both **On Receive > Split**: `SENDA_FEES_USDC` (USDC) and `SENDA_FEES_XLM` (XLM). They route collected platform fees to your treasury wallets. Create one **Read and operate** developer token covering both.
- Paiflow is optional for a first run. Everything else works without it.

## 7. Fill in `.env.local` and sign up

1. Create the file: `Copy-Item .env.example .env.local`
2. Paste the Supabase and Privy values from sections 4 and 5. Generate the two random strings:
   ```powershell
   node -e "console.log(crypto.randomUUID()+crypto.randomUUID())"   # paste as CRON_SECRET
   node -e "console.log(crypto.randomUUID()+crypto.randomUUID())"   # paste as IP_HASH_SALT
   ```
3. Paiflow ids and token (if you did section 6) go here:
   ```dotenv
   PAIFLOW_API_KEY=pfd_...
   PAIFLOW_FEES_USDC_WORKFLOW_ID=<uuid>
   PAIFLOW_FEES_XLM_WORKFLOW_ID=<uuid>
   ```
4. Run `pnpm check:env` and fix anything under "Required to run".
5. Start the app: `pnpm dev`, open http://localhost:3000, click **Try Senda**, sign in with your email, pick a username. Senda creates your Stellar wallet.
6. Make yourself admin and mediator. In Supabase **SQL Editor** run (with your username):
   ```sql
   update public.profiles set role = 'admin' where username = 'yourname';
   ```
7. Open **Wallet > Receive**, copy your address, and set `FEE_COLLECTOR_ADDRESS=<your address>` in `.env.local`. Also put it in `ops/deployer/.env` as `ESCROW_MEDIATOR` and `FEE_COLLECTOR_ADDRESS` (section 9). In the app, enable USDC on your wallet so you can receive fees.

Every variable is explained in **docs/ENV_SETUP.md**.

## 8. Configure the testnet faucet

The faucet activates new accounts with Friendbot (free) and sends test USDC from a treasury account that you fund.

```powershell
# a testnet-only hot wallet for the faucet (no --secure-store: the app needs the secret)
stellar keys generate senda-faucet --network testnet --fund
stellar keys address senda-faucet     # -> TREASURY_PUBLIC_ADDRESS
stellar keys show senda-faucet        # -> FAUCET_TREASURY_SECRET  (S...; never share, never use on mainnet)

# let the treasury hold Circle testnet USDC
stellar tx new change-trust --source senda-faucet --network testnet --line USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5
```
If `stellar tx new change-trust` isn't available in your CLI version, import the faucet secret into Freighter (Testnet) and add the USDC trustline there.

Then open **faucet.circle.com**, choose **Stellar Testnet**, paste the treasury address, and request USDC (repeat as needed; Circle limits each request). Set limits in `.env.local` (`FAUCET_*`, defaults are sensible). Restart `pnpm dev`.

**Check:** **Wallet > Test funds**: activate, enable USDC, claim test USDC. Each step shows a transaction link; the second claim inside the cooldown is refused with the next eligible time.

## 9. Compile, test and deploy the Soroban contracts

```powershell
pnpm contracts:test          # 32 tests incl. property-based tests
Copy-Item ops/deployer/.env.example ops/deployer/.env
# edit ops/deployer/.env: ESCROW_MEDIATOR=<your Senda address>, FEE_COLLECTOR_ADDRESS=<your Senda address>
stellar keys generate senda-testnet-deployer --network testnet --fund --secure-store
pnpm contracts:deploy:testnet
pnpm contracts:verify
```
The deploy prints `SOROBAN_JOB_ESCROW_CONTRACT_ID=C...`. Paste it into `.env.local` and restart `pnpm dev`. The manifest (contract id, wasm hash, transaction hashes) is saved in `ops/deployer/manifests/`. Details, secrets policy and the pause/rollback procedure: `ops/deployer/README.md`.

If `--secure-store` is rejected by your CLI version, run the same command without it.

**Check:** http://localhost:3000/api/health shows `escrowContract: ok`, and the Jobs page no longer shows the "not configured" warning.

### 9b. USDC Earn vault

The deploy above also deploys the **Senda Earn vault** (`DEPLOY_EARN_VAULT=true` in `ops/deployer/.env`). It pools deposits into Blend v2's public testnet lending pool and is **unaudited**, so the app only allows it on testnet. The deploy prints four extra lines; paste them into `.env.local`:
```dotenv
SOROBAN_USDC_EARN_VAULT_CONTRACT_ID=C...
SOROBAN_YIELD_STRATEGY_CONTRACT_ID=CCEBVDYM32YNYCVNRXQKDFFPISJJCV557CDZEIRBEE4NCV4KHPQ44HGF
EARN_ASSET_CONTRACT_ID=CAQCFVLOBK5GIULPNZRGATJJMIZL5BSP7X5YJVMGCPTUEPFM4AVSRCJU
USDC_AUTO_EARN_ENABLED=true
```
Blend's testnet pool lends **Blend's own test USDC**, not Circle's, so users need that token from Blend's testnet app before depositing. The deploy script checks the pool still lists that asset and stops with a clear message if Blend has rotated its testnet contracts. The APY shown is measured from the pool's on-chain history (after 24 hours of data), never a fixed 5%. To turn Earn off again, set `USDC_AUTO_EARN_ENABLED=false`.

## 10. Start the app

```powershell
pnpm dev
```
Open http://localhost:3000. For a production-like run: `pnpm build` then `pnpm start`.

**Check:** http://localhost:3000/api/health lists `ok` for network, supabase, horizon, sorobanRpc (and escrowContract / paiflow if configured).

## 11. Test every feature end to end

Automated first:
```powershell
pnpm test                 # unit + database/RLS tests
pnpm contracts:test       # contract tests
pnpm test:e2e             # landing, responsiveness 320-1440px, reduced motion, auth guards
pnpm build; pnpm check:secrets
```

Then by hand with two accounts: **A** in a normal window and **B** in a private window (different emails).

| # | Do this | Expect |
|---|---|---|
| 1 | A and B sign up, pick usernames | Each gets a distinct `G...` address (Settings) |
| 2 | Both: Wallet > Test funds: activate, enable USDC, claim USDC | Three confirmed tx links per user; balances match stellar.expert |
| 3 | A sends B 5 XLM by `@username`, then 1 USDC | Review screen shows exact amounts; after approval "Confirmed"; B's balance and Activity update; B gets a notification |
| 4 | B sends A 0.5 USDC by A's `G...` address | Same, reversed |
| 5 | A posts; B tips the post 1 USDC | Creator share + fee in one tx; post shows tipped total |
| 6 | A creates a premium post (price 1 USDC, unlocked text) | B sees a lock and "Unlock for 1 USDC" |
| 7 | B unlocks; then refreshes and tries again | Content appears only after confirmation; second attempt says "already own" |
| 8 | A posts a job; B applies; A sends an offer; B accepts | Job chat appears for both |
| 9 | A funds the escrow | Status Funded; contract shows locked amount; funding tx link |
| 10 | B starts work, uploads a file in chat, submits proof | Proof message with SHA-256; on-chain status ProofSubmitted |
| 11 | A requests a revision; B submits again; A approves | B receives amount minus fee, fee to collector; "Paid", payout breakdown shown; no second payout possible |
| 12 | New job: fund, then open a dispute; as admin (mediator) resolve with a split | Both parties receive their parts; mediator receives nothing |
| 13 | New job with a deadline 1-2 hours away; fund; wait past the deadline | "Refund client" works; full amount back |
| 14 | B reports a post; A (admin) hides it in Admin | Post disappears from feeds |
| 15 | Admin: Paiflow workflows (if configured): sweep 1 USDC of fees | Paiflow splits it; Sync events shows "verified" |
| 16 | `curl.exe -H "Authorization: Bearer <CRON_SECRET>" http://localhost:3000/api/cron/reconcile` | JSON report (intents checked, escrows synced, transfers indexed) |
| 17 | Resize to phone width or use devtools device mode | Bottom navigation, no sideways scrolling |

## 12. Deploy to Vercel

1. Put the project on GitHub as a **private** repo (VS Code > Source Control > Publish to GitHub). `.env.local` and deployer secrets are git-ignored.
2. vercel.com > **Add New > Project** > import the repo. Framework: Next.js (auto). Build command `pnpm build`.
3. **Environment Variables**: add every value from your `.env.local` (mark secrets as **Sensitive**). Set `NEXT_PUBLIC_APP_URL=https://<your-project>.vercel.app`.
4. Deploy. Then in Privy **Allowed origins**, add `https://<your-project>.vercel.app`.
5. Cron: `vercel.json` runs the reconciler daily (Hobby plan limit). For more frequent runs, use an external scheduler (e.g. cron-job.org) calling `GET https://<your-app>/api/cron/reconcile` with header `Authorization: Bearer <CRON_SECRET>` every 5 minutes. Status checks in the app also reconcile on demand.
6. **Check:** `https://<your-app>/api/health` with the `Authorization: Bearer <CRON_SECRET>` header returns all `ok`; repeat test rows 1 to 4 on the live site.

Mainnet is intentionally not part of this guide. It needs an independent audit, legal review and your written approval: run `pnpm contracts:mainnet-plan` to see the gated checklist.
