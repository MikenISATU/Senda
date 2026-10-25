# Senda build checklist

Legend: **Done** = built and verified in the build environment. **Built, verify live** = code complete, but needs real keys/network to exercise (the build environment had no access to Stellar testnet, Paiflow, Privy or Supabase). **Your action** = only you can do it.

## Done (verified)
- [x] Paiflow, Privy, Stellar, Blend research and compatibility matrix (docs/INTEGRATION_MATRIX.md)
- [x] Next.js 16 + TypeScript + Tailwind 4 + pnpm project; `pnpm build` passes; typecheck clean
- [x] Supabase migrations (33 tables, RLS on all, storage buckets, realtime). Applied to an embedded Postgres in tests: exactly-once entitlement, RLS visibility, blocked client writes, rate limiter
- [x] Soroban `job_escrow`: 23 tests incl. property test (value conservation, no double payout, lock accounting, squatting, late proof, mediator snapshot)
- [x] Soroban `usdc_earn_vault` (testnet only, unaudited; Earn routes through it when configured): 7 tests incl. property test (no yield without strategy, no free money, inflation attack)
- [x] Transaction intent engine: server-built XDR, Privy raw-hash signature verified against stored hash, guarded single submission, reconciler (signature verification unit tested)
- [x] Paiflow adapter (capabilities/prepare/submit/lookupStatus/events) + independent envelope check (unit tested with mocked API)
- [x] Landing page with animated 3D product demo (send, tip, hire, save), team, roadmap and partner strip; E2E at 320/375/768/1024/1440px (30 checks pass: no overflow, 44px targets, keyboard FAQ, auth guards)
- [x] Client bundle secret scan passes
- [x] ops/deployer: testnet deploy + verify scripts, manifests, gated mainnet plan, secrets policy
- [x] Independent security review of money paths; all 12 real findings fixed (contract + server + database) with regression tests
- [x] Single-file Supabase setup: `supabase/RUN_THIS_IN_SUPABASE.sql` (validated on embedded Postgres)
- [x] START_HERE.md, docs/ENV_SETUP.md, docs/PAIFLOW_SETUP.md, docs/SECURITY.md

- [x] **Deployed to testnet (2026-10-24)**: job_escrow `CAPHY7BPH7T374NWFHZSSYEU24URTGREWW7XNSPENKALSPUJFIFVDUUN`, usdc_earn_vault `CCHVH2MXKFSKC5WCWMGL3GGMPKA37UZTCJTUSLQMJDOKDFD6AOXURV67`; on-chain code verified against manifest; live escrow test (fund 10 XLM, proof, approve) paid out correctly

## Built, verify live (after your keys are in)
- [ ] Privy email login and automatic Stellar wallet creation + server-side ownership check
- [ ] Faucet: Friendbot activation, USDC trustline, treasury USDC grant, cooldown and caps
- [ ] Send/receive XLM and USDC by username or address; history from Horizon
- [ ] Tips and premium purchases (atomic split, entitlement after confirmation)
- [ ] Social feed, profiles, follows, likes, comments, reposts, media uploads, notifications, reports
- [ ] Jobs: post, apply, offer, accept, fund escrow, chat with attachments, proof (SHA-256 on-chain), revision, approve, claim after review, refund after deadline, dispute + mediator split, mutual settlement
- [ ] Realtime chat (needs `SUPABASE_JWT_SECRET`, else 4s polling)
- [ ] Paiflow fee sweep through your Receive > Split deployment; event sync and verification
- [ ] USDC Earn vault deposit/withdraw with Blend test USDC (vault deployed and wired; no live deposit yet)
- [ ] Reconciler cron on Vercel
- [ ] Authenticated app screens reviewed visually on phone and desktop (only the landing page could be screenshotted without Privy keys)

## Your action
- [ ] Install tools (START_HERE section 1)
- [ ] Create Supabase project, run `supabase/RUN_THIS_IN_SUPABASE.sql`, copy keys (section 4)
- [ ] Create Privy app, enable email, allowed origins, copy keys (section 5)
- [ ] Optional: build Paiflow fee-split flow + developer token (section 6, docs/PAIFLOW_SETUP.md)
- [ ] Fill `.env.local`, sign up, make yourself admin, set `FEE_COLLECTOR_ADDRESS` (section 7)
- [ ] Create and fund the faucet treasury from Circle's faucet (section 8)
- [ ] Import the deployer key from `ops/deployer/secrets/testnet-deployer.secret` into your Stellar CLI keychain, then delete that file
- [ ] Run the manual test table (section 11)
- [ ] Deploy to Vercel and add the domain to Privy (section 12)
- [ ] Before any mainnet step: audit, legal review, written approval (`pnpm contracts:mainnet-plan`)
