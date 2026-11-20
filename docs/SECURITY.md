# Security model and threat review

## Trust boundaries
- **Identity**: Privy. Every API call verifies the Privy access token server-side; the Privy user id is never taken from the request body. Profile mapping lives in `profile_private` (invisible to clients).
- **Money**: the user's Privy wallet signs; the Stellar ledger and the escrow contract are the authority. The database is a cache.
- **Server**: builds transactions, stores the exact XDR, and only submits a signature that verifies against the stored hash (`attachSignature`). The client receives only the hash and a human summary.

## Threats and mitigations
| Threat | Mitigation |
|---|---|
| Replay / double submit | `prepared -> submitted` is a guarded UPDATE; Stellar sequence numbers and time bounds make each envelope single-use |
| Double entitlement / double tip credit | `confirm_purchase` / `confirm_tip` SQL functions update `pending -> confirmed` once; unique `(profile_id, product_id)` entitlement; tested |
| Fee misrouting | Fees are split on-chain by `fee_splitter`: the rate (max 10%) and recipients are read from the contract, never from the request; `pay` moves exactly the stated amount and nothing passes through the contract's own balance; the server shows the split before the user confirms |
| Fees stuck | `distribute` is open to anyone and keeps working when `pay` is paused |
| Duplicate side effects | Confirmation effects run once per intent (guarded `effects_applied_at` claim); purchase/tip SQL guarded; a second paid purchase becomes `duplicate` + refund notice |
| Impersonated usernames | Handles resolve only to wallets whose ownership the server confirmed via Privy's API; reserved names blocked |
| Malicious token / wrong network | Escrow token allow-list; passphrase checked against network; USDC SAC id derived and compared |
| Escrow seizure | No admin path moves funds; mediator snapshotted per job and can only split between the two parties; pause blocks funding only; upgrades timelocked 7 days (admin must be multisig) |
| Job id squatting | On-chain id = sha256(client address XDR, salt); server verifies on-chain client/freelancer/token/amount before trusting a record |
| Late proof blocking refund | `submit_proof` rejected after the deadline |
| Free 50% via stale dispute | Fallback depends on state: pending proof -> freelancer, otherwise -> client |
| Client ghosting / freelancer ghosting / mediator absent | Claim after review window; refund after deadline; state-based fallback after 30-day stale dispute |
| Reentrancy | Soroban forbids re-entry; contracts update state before token transfers |
| Storage TTL expiry | Instance and persistent entries extended on every read/write (30/120 days) |
| Storage bloat / spam | Rate limits (Postgres-backed), size caps on posts, messages, uploads; upload paths chosen by the server |
| Uncertain submission | Never re-sign; intent stays `submitted`; reconciler resolves the original hash; classic tx marked failed only after max time passes |
| CSRF | Bearer-token auth (no ambient cookies) + Origin check on mutations |
| XSS / clickjacking | React escaping, CSP, `X-Frame-Options: DENY`, `frame-ancestors 'none'`; SVG/HTML uploads refused |
| Secret leakage | Server-only env (`server-only` imports), `pnpm check:secrets` bundle scan, deployer key in OS keychain |
| Faucet abuse | One profile per verified email, signup grant once, per-asset cooldown window enforced by a unique key, per-IP daily limit, daily treasury cap, balance check, mainnet hard-off |
| Private content leakage | Premium body in a separate RLS-protected table; premium/chat files in private buckets served by 5-10 minute signed URLs after entitlement/membership checks |

## Known gaps before mainnet
- Independent audit of `job_escrow` and `fee_splitter` (and of `usdc_earn_vault` if ever used).
- `fee_splitter` admin is a single key that can change fee recipients and rates (capped at 10%); use a multisig. If a fee recipient loses its USDC trustline, USDC payments through the contract fail until it is restored or the recipients are changed.
- Upload malware scanning (hook point: `/api/uploads` + attachment registration) is not implemented.
- CSP uses `'unsafe-inline'` for scripts (Next.js bootstrap); move to nonces for stricter policy.
- Mediator is a single key; use a multisig or a mediator panel for production.
- Escrow payouts are push-based: if a party removes their trustline or is frozen by the issuer, settlement paths that pay them revert until fixed. Pull-based withdrawals would remove this.
- Faucet (testnet): daily-cap check is not atomic and concurrent treasury sends can collide on sequence numbers; pending claims are not reconciled.
- Wallet addresses are publicly linked to usernames (required for pay-by-username), which links profiles to on-chain history.
- Anomaly monitoring/alerting is limited to audit logs and the Admin page.
