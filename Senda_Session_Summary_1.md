# Senda_Session_Summary_1

Date: 2026-10-24. Scope: initial full build from CLAUDE_MASTER_PROMPT.md + Senda_Claude_Build_Spec_Final.pdf.

## Decisions
- D1. Paiflow hosted beta: testnet only, recipients fixed at deploy, no API flow creation, Dev mode off, no outbound signed webhooks. => SEND/RECEIVE via Stellar SDK; JOB_FUND via Soroban job_escrow; TIP/POST_PURCHASE = atomic Stellar 2-leg split (creator + fee) + Paiflow On Receive->Split used for platform-fee sweep (admin, fee-collector wallet signs). Unused workflow ids kept in env, surfaced on Admin with live capabilities.
- D2. PaiflowAdapter = direct HTTP to documented /api/v1 (SDK 0.2.0 needs Node >=22.22.2 <23). Independent envelope check (`assertPaiflowDeposit`) before user signs.
- D3. Signing: server builds+stores XDR (tx_intents), client signs hash with Privy `useSignRawHash({chainType:'stellar'})`, server verifies signature against stored hash then submits. Guarded prepared->submitted UPDATE. Reconciler resolves original hash; never re-sign.
- D4. Auth: Privy access token verified server-side (`@privy-io/node`), profile mapping in `profile_private`. Wallet ownership verified via Privy `users()._get`. Supabase: all writes via service role; RLS on every table; optional minted HS256 JWT (`sub`=profile id) for realtime reads; fallback polling.
- D5. Escrow: Soroban job_escrow (soroban-sdk 29.0.1). Fee snapshot per job (max 10%), review window claim, deadline refund (permissionless, to client), dispute -> mediator split between parties only, 30-day stale 50/50, mutual settlement, pause = new funding only, 48h timelocked upgrade, 2-step admin.
- D6. Earn: default OFF. App path = non-custodial direct Blend v2 pool supply from user wallet; APY measured from b_rate snapshots (>=24h); 5% shown only as illustration. usdc_earn_vault built + tested but unaudited and unused.
- D7. Faucet: Friendbot activation; treasury hot wallet (testnet-only secret env) for USDC + repeat XLM; per-asset cooldown via unique idempotency key; IP + daily caps; hard-off on mainnet.
- D8. Testnet USDC issuer GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5; SAC CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA (derived).
- D9. Fonts self-hosted via @fontsource (no Google Fonts fetch at build). Tailwind 4 custom classes as @utility.
- D10. Playwright pinned 1.63.0 to match sandbox browser; user runs `pnpm exec playwright install chromium`.

- D11. Independent review (subagent) -> fixes: on-chain job id = sha256(client ScVal XDR || salt) (anti-squat; JS/Rust cross-tested vector ae8afb6e...); submit_proof <= deadline; stale-dispute fallback state-based (proof pending -> freelancer, else client); mediator snapshotted per job; settlement cleared on state change; upgrade timelock 7d; syncEscrow verifies on-chain terms; assertPaiflowDeposit checks contract (TOFU pin), auth tree, fee cap 10 XLM, validity <=600s; effects exactly-once via tx_intents.effects_applied_at; Soroban/classic expiry only when provable (Horizon latest ledger close time; Soroban 2min..6h window); duplicate purchase -> status 'duplicate' + refund notice; failed->confirmed allowed in confirm fns; column grants hide tx_intents.xdr + linked_wallets.privy_wallet_id; mediator attachment access only for DISPUTED job chats; proof chat message posted on confirmation, freelancer-uploaded evidence only; CANCELLED jobs private; no Supabase token for banned users; faucet slot kept after send.
- D12. User request 2026-10-24: Earn live through usdc_earn_vault on testnet (mode=vault when SOROBAN_USDC_EARN_VAULT_CONTRACT_ID set; mainnet blocked unless EARN_VAULT_AUDITED=true). Deployer DEPLOY_EARN_VAULT=true default, Blend TestnetV2 pool + Blend test USDC, pre-deploy get_reserve check.
- D13. Supabase single-file setup: supabase/RUN_THIS_IN_SUPABASE.sql (4 migrations concatenated). Privy/Supabase/Paiflow need env + docs only.
- D14. Live testnet deploy by assistant blocked by egress; user asked to allowlist soroban-testnet.stellar.org, horizon-testnet.stellar.org, friendbot.stellar.org, static.rust-lang.org. stellar-cli being installed from crates.io in sandbox.

- D15. Testnet deploy 2026-10-24 by assistant. Deployer GCWPFDF44ISIKDKC6I4KCV6LP3BHHG55JWGEZJE4NTI4O6Q4ZPGF66SX (admin, guardian, mediator, fee_collector). Secret saved per user request to D:\Senda\ops\deployer\secrets\testnet-deployer.secret (git-ignored); user to import to CLI keychain and delete. job_escrow CAPHY7BPH7T374NWFHZSSYEU24URTGREWW7XNSPENKALSPUJFIFVDUUN (deploy tx 47070ae4...), usdc_earn_vault CCHVH2MXKFSKC5WCWMGL3GGMPKA37UZTCJTUSLQMJDOKDFD6AOXURV67 (deploy tx f3b30747...). Manifest ops/deployer/manifests/testnet-2026-10-24T14-51-22-296Z.json. Live smoke: fund 6510c740..., proof 7ef50de0..., approve 17978e26...; freelancer +9.75 XLM, fee 0.25.
- D16. Testnet rent high (18.8KB upload ~205-235 XLM). TTL policy changed: instance 7d (threshold 6d), persistent 14d (threshold 7d), top-up on use; archived entries restorable. Per-op user fees observed: fund ~5 XLM, proof ~0.13, approve ~0.002.
- D17. Admin sweep accepts all five Paiflow keys; mapping: CREATOR_TIPS->TIP (USDC fees), POST_PURCHASE (USDC), JOB_PAYMENT->JOB_FUND (escrow fees, USDC), RECEIVE_PAYMENT->RECEIVE (XLM fees), SEND_PAYMENT->SEND (XLM faucet refill).

## Deliverables
- App: src/ (landing + 3D hero, auth, onboarding, home/explore feeds, profiles, posts, wallet, earn, messages, jobs, notifications, settings, admin; 43 API routes).
- DB: supabase/migrations/2026102400000{1,2,3,4}_*.sql (33 tables) + supabase/RUN_THIS_IN_SUPABASE.sql.
- Contracts: contracts/{shared,job_escrow,usdc_earn_vault}; 26 tests pass.
- Ops: ops/deployer/{README.md,.env.example,.gitignore,scripts/deploy-testnet.{mjs,sh},verify.{mjs,sh},deploy-mainnet-plan.mjs,manifests/}.
- Docs: START_HERE.md, docs/{ENV_SETUP,PAIFLOW_SETUP,CHECKLIST,SECURITY,INTEGRATION_MATRIX}.md, README.md, .env.example.
- Verification: vitest 24/24, cargo 32/32, Playwright 30/30 (5 viewports), next build OK, tsc clean, bundle secret scan clean.

## Open threads
- O1. Deployed (D15). Earn vault live deposit untested (needs Blend test USDC). Escrow fee_collector = deployer; change via set_roles if desired.
- O2. Authenticated screens not visually reviewed (need Privy keys). Review on first run.
- O3. soroban-sdk 29.0.1 vs testnet protocol: if deploy rejects wasm, align SDK version with network protocol.
- O4. Blend testnet pool uses Blend test USDC, not Circle USDC; Earn on testnet is experimental. Pool id from blend-utils may be stale.
- O5. Privy dashboard may require enabling extended chains/Stellar; verify on first login.
- O6. Pre-mainnet: audit, upload malware scanning, CSP nonces, multisig admin/mediator, legal review.
- O7. Hardening not done: push-based escrow payouts (trustline removal/freeze can block settlement); faucet daily-cap race + sequence collisions; wallet<->username public linkage (by design).

## Session 2 (2026-10-25)
- D18. Fee collector = deployer GCWPFD...F66SX (deployer USDC trustline added, tx a60f69f9...). Faucet treasury GAJFQE...YNCO created (2000 XLM, USDC trustline); secret in ops/deployer/secrets/faucet-treasury.secret (git-ignored). Treasury topped up 875.64 USDC via testnet DEX swap from deployer (tx 6ce70a49...).
- D19. Landing redesign: plain language (no chain/tech names in hero), CSS-3D FeatureDemo (Send/Tip/Hire/Save), team (Miles Kenneth Napilan founder+dev; Alicia Amor Cerrudo co-founder+head of BD), roadmap with Testnet = Now, partners marquee L->R (Stellar, Paiflow, Supabase, Privy, Vercel, Web3 Iloilo), tab icons in src/app.
- D20. Login: split layout, inline Privy headless email OTP (useLoginWithEmail); 10s slow-load hint. NEXT_PUBLIC_PRIVY_CLIENT_ID ignored unless it starts with "client-".
- D21. Supabase URL normalised to origin everywhere (supabaseOrigin), incl. CSP. Upload picker limited to supported types; clearer upload errors. Added missing .label/.hint/.sheet styles.
- D22. App shell redesign: max 1480px, left icon nav, right rail (balance + quick actions + things to try, xl+), card feed, floating mobile nav.
- D23. Paiflow reduced to 2 flows (On Receive > Split): FEES_USDC, FEES_XLM. Env PAIFLOW_FEES_USDC_WORKFLOW_ID / PAIFLOW_FEES_XLM_WORKFLOW_ID (old TIP/RECEIVE ids read as fallback). Sends, requests, tips, purchases stay direct payments; job escrow contract kept.
- D24. Chat "Request money": migration 0005 payment_requests (server-only, RLS no client access), message kind 'request'; pay = normal payment intent with payload.requestId; marked paid only on confirmation (effects.ts); guarded intent claim prevents double prepare.
- D25. Earn hidden from nav; USDC_AUTO_EARN_ENABLED=false in .env.example; landing Save marked "coming later".
- Verification: vitest 25/25, Playwright 35/35, tsc clean, next build OK.
- O8. User must run supabase/migrations/20261025000005_payment_requests.sql in Supabase SQL editor (existing DB).
- O9. Old files HeroArt/HeroScene/HeroPoster still on D:\Senda (bridge cannot delete); unused.
