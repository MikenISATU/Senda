# Environment setup

## Create `.env.local`

1. In VS Code's file explorer, right-click `.env.example` and choose **Copy**, then **Paste**. Rename the copy to `.env.local` (exactly that name, in the project root next to `package.json`).
   PowerShell alternative: `Copy-Item .env.example .env.local`
2. Fill in values using the table below. Leave optional values blank until you reach that step in START_HERE.md.
3. Run `pnpm check:env`. It lists what is missing and warns about secrets in the wrong place (it never prints values).
4. Restart `pnpm dev` after every change. Next.js reads env files only at startup.

`.env.local` is ignored by Git. Never commit it, paste it in chat, or put it in screenshots.

**Public vs secret.** Anything starting with `NEXT_PUBLIC_` is compiled into the browser bundle and anyone can read it. Only public identifiers go there. Every secret below is server-only. After `pnpm build`, run `pnpm check:secrets` to scan the browser bundle for leaked keys.

## Variables

| Variable | Where to get it | Public / Secret | Paste into | How to verify |
|---|---|---|---|---|
| `NEXT_PUBLIC_APP_URL` | `http://localhost:3000` locally; your Vercel URL in production | Public | `.env.local`, Vercel | Site loads at that URL |
| `NEXT_PUBLIC_BRAND_NAME` | Keep `Senda` | Public | `.env.local` | n/a |
| `NEXT_PUBLIC_STELLAR_NETWORK` / `STELLAR_NETWORK` | `testnet` | Public / Server | `.env.local`, Vercel | `/api/health` shows `"network":"testnet"` |
| `STELLAR_RPC_URL` | Blank on testnet (defaults to `https://soroban-testnet.stellar.org`). Mainnet: a provider from developers.stellar.org/docs/data/apis/rpc/providers | Server | `.env.local` | `/api/health` check `sorobanRpc: ok` |
| `STELLAR_HORIZON_URL` | Blank on testnet (defaults to `https://horizon-testnet.stellar.org`) | Server | `.env.local` | `/api/health` check `horizon: ok` |
| `STELLAR_NETWORK_PASSPHRASE` | Blank on testnet. The app refuses a passphrase that doesn't match the network | Server | `.env.local` | `/api/health` check `network: ok` |
| `STELLAR_USDC_ISSUER` | Prefilled: Circle's testnet issuer `GBBD47IF...LFLA5` (Circle faucet, Paiflow docs). **Mainnet has a different issuer**: copy it from Circle's official docs at mainnet time | Server | `.env.local` | Wallet page "Enable USDC" shows the same issuer |
| `STELLAR_USDC_ASSET_CONTRACT_ID` | Prefilled. Derived from the issuer; the app checks they match | Server | `.env.local` | App errors clearly if it doesn't match |
| `STELLAR_XLM_ASSET_CONTRACT_ID` | Prefilled (native XLM contract on testnet) | Server | `.env.local` | Same |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase dashboard > your project > **Project Settings > API** (or **Connect**) > Project URL | Public | `.env.local`, Vercel | `/api/health` check `supabase: ok` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Same page: **anon public** key (newer projects call it **publishable** key, `sb_publishable_...`) | Public (RLS protects data) | `.env.local`, Vercel | Same |
| `SUPABASE_SERVICE_ROLE_KEY` | Same page: **service_role** key (newer projects: **secret** key, `sb_secret_...`) | **Secret** | `.env.local`, Vercel (Sensitive) | Same |
| `SUPABASE_JWT_SECRET` | **Project Settings > JWT Keys > Legacy JWT secret** (reveal and copy) | **Secret** | `.env.local`, Vercel | Messages update instantly instead of every 4 seconds; `/api/health` shows `supabaseRealtimeJwt: true` |
| `NEXT_PUBLIC_PRIVY_APP_ID` | dashboard.privy.io > your app > **Configuration > App settings > Basics** > App ID | Public | `.env.local`, Vercel | Login page shows "Continue with email" instead of "Almost there" |
| `NEXT_PUBLIC_PRIVY_CLIENT_ID` | Optional. Same area > **Clients** (only if you created an app client) | Public | `.env.local` | n/a |
| `PRIVY_APP_SECRET` | Same Basics page > App secret (shown once when created; create a new one if lost) | **Secret** | `.env.local`, Vercel (Sensitive) | Sign-in completes and creates your profile |
| `PAIFLOW_API_BASE_URL` | Keep `https://beta.app.paiflow.xyz` (testnet) | Server | `.env.local` | Admin page lists workflow capabilities |
| `PAIFLOW_API_KEY` | Paiflow > **Developer API** (`/account/developer`) > Create developer token, **Read and operate**, select your deployments (`pfd_...`). Or a deployment's **API access** panel (`pfk_...`). Shown once | **Secret** | `.env.local`, Vercel (Sensitive) | Admin > Paiflow workflows shows trigger types, no errors |
| `PAIFLOW_FEES_USDC_WORKFLOW_ID`, `PAIFLOW_FEES_XLM_WORKFLOW_ID` | Deployment **UUID** of your two fee-split flows, from the Paiflow deployment page URL `/deployments/<uuid>` (not the flow id, not the `C...` contract). See docs/PAIFLOW_SETUP.md | Server | `.env.local`, Vercel | Admin page row shows `execute: supported` |
| `PAIFLOW_WEBHOOK_SIGNING_SECRET` | Only for Paiflow HTTP Webhook flows (deployment **API access** panel). Unused by default | **Secret** | `.env.local` | n/a |
| `SOROBAN_JOB_ESCROW_CONTRACT_ID` | Printed by `pnpm contracts:deploy:testnet`; also in `ops/deployer/manifests/testnet-*.json` | Server | `.env.local`, Vercel | `/api/health` check `escrowContract: ok`; Jobs page no longer warns |
| `SOROBAN_USDC_EARN_VAULT_CONTRACT_ID` | Printed by `pnpm contracts:deploy:testnet` (Earn vault). Blank = users supply to Blend directly | Server | `.env.local`, Vercel | Earn page says deposits go through the Senda Earn vault |
| `EARN_VAULT_AUDITED` | `false`. Only `true` after an independent audit; required to use the vault on mainnet | Server | `.env.local` | n/a |
| `SOROBAN_YIELD_STRATEGY_CONTRACT_ID` | A Blend v2 pool contract id (testnet example in START_HERE section 9b). Leave blank to keep Earn off | Server | `.env.local` | Earn page shows pool utilization |
| `EARN_ASSET_CONTRACT_ID` | The asset that pool lends. Blank = Circle USDC | Server | `.env.local` | Earn page shows the asset notice |
| `FEE_COLLECTOR_ADDRESS` | Your own Senda wallet address (Wallet > Receive) after you sign up, with USDC enabled | Public address, server env | `.env.local`, Vercel | Tip summary shows a platform fee line |
| `PLATFORM_FEE_BPS` | `250` = 2.5%. Max sensible 1000 | Server | `.env.local` | Tip summary fee matches |
| `TREASURY_PUBLIC_ADDRESS` | `stellar keys address senda-faucet` (START_HERE section 8) | Public address, server env | `.env.local`, Vercel | Admin page shows treasury balances |
| `FAUCET_TREASURY_SECRET` | `stellar keys show senda-faucet` (testnet-only key you created for this) | **Secret** | `.env.local`, Vercel (Sensitive) | Wallet > Test funds > claim USDC succeeds with a tx link |
| `USDC_AUTO_EARN_ENABLED` | `false` until you configure a pool and accept the risks | Server | `.env.local` | Earn page explains why it is off |
| `USDC_TARGET_APR_DISPLAY` | `0.05` (illustrative only) | Server | `.env.local` | Earn calculator uses it, labelled as an illustration |
| `FAUCET_ENABLED` | `true` on testnet. Forced off on mainnet by code | Server | `.env.local` | Wallet shows the Test funds panel |
| `FAUCET_*_AMOUNT`, `FAUCET_CLAIM_COOLDOWN_HOURS`, `FAUCET_DAILY_TREASURY_CAP`, `FAUCET_MAX_CLAIMS_PER_IP_PER_DAY` | Your limits. Defaults are in `.env.example` | Server | `.env.local` | Second claim inside the window is refused with the next time |
| `CRON_SECRET` | Generate: `node -e "console.log(crypto.randomUUID()+crypto.randomUUID())"` | **Secret** | `.env.local`, Vercel | `curl -H "Authorization: Bearer <secret>" http://localhost:3000/api/cron/reconcile` returns a report |
| `IP_HASH_SALT` | Generate the same way | **Secret** | `.env.local`, Vercel | n/a |
| `CSP_REPORT_ONLY` | `false`. Set `true` temporarily if the browser console shows Content-Security-Policy blocks | Server | `.env.local` | n/a |

## Verify everything at once

With `pnpm dev` running, open **http://localhost:3000/api/health**. In development it runs live checks and prints `ok` or the exact error for: network, Supabase, Horizon, Soroban RPC, the escrow contract, and each configured Paiflow deployment. In production the same deep check needs an admin login or `Authorization: Bearer <CRON_SECRET>`.

## Deployer secrets are separate

The contract deployer key never goes in `.env.local`. It lives in the Stellar CLI's identity store (OS keychain with `--secure-store`). See `ops/deployer/README.md`.
