# CLAUDE MASTER BUILD PROMPT - SENDA

You are the principal full-stack engineer, Soroban smart-contract architect, security reviewer, and product designer for SENDA. Read the attached `Senda_Claude_Build_Spec.pdf` entirely before coding. Implement a working mobile-responsive app; do not replace functional behavior with mock buttons. Execute in verifiable milestones. Use the latest documentation; report blockers rather than inventing SDK calls, APIs, workflow IDs, contract addresses, or yield sources.

## First research these links
- https://github.com/artisam-paiflow/paiflow
- https://github.com/artisam-paiflow/paiflow/blob/develop/docs/api/README.md
- https://github.com/artisam-paiflow/paiflow/blob/develop/packages/sdk/README.md
- https://beta.app.paiflow.xyz/
- https://x.com/usepaiflow
- https://docs.privy.io/llms.txt
- https://developers.stellar.org/docs/
- https://developers.stellar.org/docs/tools/cli/cookbook/upload-deploy
- https://docs.blend.capital/
- https://supabase.com/docs

Document compatibility of Paiflow hosted deployment/network, authentication, workflow deployability, receive triggers, payment/split, webhook signatures, and prepare/sign/submit requirements. Validate Stellar-compatible user wallet provisioning and signing through Privy. Identify supported real USDC asset issuer for target network; never confuse test token with real USDC. Do not invent a universal mainnet faucet or guaranteed 5% APR.

## Product
Brand SENDA: social-first Stellar platform, email signup through Privy and Stellar wallet provisioning; XLM/USDC wallet; username-based payments, receive QR; creator feed/posts, tips, premium paid posts; jobs marketplace with chat and proof-of-work; funded Soroban escrow and release/refund/dispute; testnet XLM + USDC onboarding faucet; opt-in USDC Auto Earn targeting illustrative 5% simple APR only if an actual audited yield source supports it. Show live, confirmed on-chain state, not fabricated balances. Network selection: testnet first with clean mainnet configs.

## Mandatory UI
Landing page with premium restrained interactive 3D looping artwork, full mobile responsiveness, keyboard access, reduced-motion fallback, performance-friendly loading, no wallet connection needed to read marketing pages. Brand: ink #101B2D, cobalt #4169F5, pale #F5F7FC, mint #24CBA8, white #FFFFFF; heading font Space Grotesk, body font Manrope, numerical amounts tabular. Main hero: "Share more. Send easier. Earn together." Primary CTA "Try Senda". Features, how it works, safety/yield disclosure, FAQ, footer. Auth routes, home feed, explore, messages, jobs, wallet, earn, settings/admin. Mobile bottom nav with reachable actions; desktop left rail/sidebar. Proper focus states, WCAG AA contrast and 44px tap targets.

## Payment + Paiflow integration
Implement a dedicated server-side `PaiflowAdapter` with typed methods `prepare`, `submit`, `lookupStatus`, and verified event handling based ONLY on documented API. Define workflow references through env only (see ENV_TEMPLATE), never hardcode ID/API secrets in client bundles. Build/assign appropriate Paiflow deployments after checking supported trigger/action combinations:
1. `SEND` outgoing authorized XLM/USDC.
2. `RECEIVE` inbound monitoring/receive-trigger for deposits and webhook reconciliation. Note receipt into ordinary wallet may be native Stellar transfer and not require a deployment.
3. `TIP` social tip with optional fee split.
4. `POST_PURCHASE` creator payout/platform fee split, grant content access only after confirmed settlement; make delivery idempotent.
5. `JOB_FUND` escrow funding integration where feasible; actual locked balance and release/refund/dispute rules MUST be Soroban-enforced rather than trusted to a Paiflow webhook.
If the hosted beta cannot support a desired workflow/API, use Stellar SDK + Soroban adapter directly with an explicit documented fallback while keeping Paiflow integrated for supported routes. No unsupported claims.

## Smart contracts
Create workspace `contracts/` with crates/modules `job_escrow`, `usdc_earn_vault` (only after a real audited yield adapter), `treasury_controls` if necessary, interfaces, tests, deployment manifests. Job escrow must enforce authorization, exact token/amount, unique job ID, state transitions, deadline/timeout/refund, event emission, one-time payout, dispute mechanism (no unilateral platform seizure), access controls, non-reentrancy / cross-contract call assumptions, checked arithmetic, reserve/fees, storage TTL/bump, upgrade governance and emergency pause. Provide permissionless read methods. Detailed contract invariants and property-based tests. Do not fabricate 5% from new user deposits. Yield vault must expose strategy shares accounting, deposit/withdraw permissions, variable displayed APY from verifiable sources, explicit losses/withdrawal constraints, pause and emergency procedures, independent audit gate. If not safely integrable, disable Auto Earn feature flag, build testnet-only simulation clearly labeled, and document why.

## Security and deployer directory
Generate `ops/deployer/README.md`, `ops/deployer/.env.example`, `ops/deployer/.gitignore`, `ops/deployer/scripts/deploy-testnet.sh`, `ops/deployer/scripts/verify.sh`, and reproducible CLI commands. Keep actual deployer secrets OUTSIDE the source tree, Git, PDF, browser bundle, logs, CI artifacts, and Supabase. Preferred secret store is hardware wallet or managed secrets vault; inject key at execution into a temporary process environment or secure CLI identity. Never automatically create a plaintext seed phrase file. `.env.example` must contain placeholders ONLY. Separate testnet deployer from mainnet deployer; use least-privilege roles; require manual explicit human confirmation before any mainnet contract deploy, treasury funds movement, upgrades, or irreversible changes. Do not request users paste seeds into chat.

## Database and services
Supabase PostgreSQL migrations with RLS: users/profiles, wallet_addresses, follows, posts/media, comments, tips, products, purchases/entitlements, jobs, offers, chats/messages, attachments/evidence, escrow_jobs, transactions/ledger_events, workflow_runs, earn_positions, faucet_claims, notifications, audit_events and admin moderation. Privy identity is the authentication authority and must be securely mapped to database auth/RLS; never trust a user-supplied privy user id. Private content requires per-purchaser policy. Chat attachments signed URLs. Event/webhook authenticity and idempotency, replay protection, state-machine transaction boundaries, reconciler for reorg/failed tx and duplicate event.

## Acceptance criteria
1. New test user can email-sign-in and receive a distinct functional Stellar wallet.
2. Testnet faucet funds XLM and, only after correct trustline/token handling, test USDC; show confirmed tx hashes and anti-Sybil limits.
3. Two users can send and receive XLM/USDC; balances reconcile on-chain.
4. Tip a profile/post and buy a post; entitlement appears only after confirmed payment, no double grant on webhook retry.
5. Client posts job, hires freelancer, funds escrow, communicates in chat, receives proof, and authorizes completion; contract pays exactly once. Refund/dispute paths tested.
6. Earn is opt-in; 5% example clearly marked indicative; no fake yield and no unreviewed production deposits.
7. All functionality works on desktop/tablet/phone; mobile 360px wide; accessible reduced-motion 3D fallback.
8. Automated tests, contract tests, E2E, security checks pass; deliver deployment manifest addresses and transaction links.

## Sequence
A. Documentation verification + implementation matrix. B. Architecture/schema/design tokens and actual `.env.example`. C. Wallet and faucet. D. Send/receive. E. Social/tips/posts. F. Soroban escrow/jobs/chat. G. Yield integration only if trustworthy. H. Deploy testnet, automated E2E and threat-model review. I. Mainnet deployment plan requiring manual signoff.

When finished, report actual completed functionality, real deployment addresses, observed transaction IDs and tests. Do not claim completion of untested actions. Start by checking documentation and outputting a precise build plan, then implement in the repository.
