# Integration matrix (verified 24 Oct 2026)

| Integration | Source checked | Finding | Senda decision |
|---|---|---|---|
| Paiflow hosted network | github.com/artisam-paiflow/paiflow `docs/api/README.md` | `https://beta.app.paiflow.xyz` runs on **Stellar testnet** only | Testnet integration; mainnet requires Paiflow's own mainnet rollout |
| Paiflow auth | same | `Authorization: Bearer pfk_...` (one deployment) or `pfd_...` (developer token, selected deployments, Read and operate) | Server-only `PAIFLOW_API_KEY`, format-validated |
| Paiflow workflow deployability | same + `docs/hackathon/paiflow-guide.md` | Flows are drawn and deployed manually in the dashboard; **no API to create flows/deployments**; recipients fixed at deploy; Dev mode (per-payment recipients) disabled | SEND / RECEIVE / JOB_FUND cannot be per-user Paiflow flows; implemented with Stellar SDK / Soroban |
| Paiflow receive trigger | same | On Receive = deposit into the flow's trigger contract; executable via prepare/sign/submit | Used for the fee-split flow (TIP / POST_PURCHASE fee sweep) |
| Paiflow payment/split | same | Pay / Split with fixed or percentage recipients; trustlines required on recipients | Fee sweep to fixed treasury/community recipients |
| Paiflow webhook signatures | same | No outbound signed webhooks to integrators. HTTP Webhook trigger = inbound call with `x-webhook-secret` + Idempotency-Key | Events pulled via `GET /events`, deduped by `eventId`, verified via `GET /transactions/{hash}` |
| Paiflow prepare/sign/submit | same + SDK README 0.2.0 | Unsigned XDR expires ~180s; submit idempotent on envelope hash; `x-preparation-request-id` correlation; PENDING/UNKNOWN never authorize replacement | `PaiflowAdapter` + independent envelope check (`assertPaiflowDeposit`) before user signs |
| Paiflow SDK | `packages/sdk/README.md` | `@paiflow/sdk@0.2.0`, Node `>=22.22.2 <23`, no runtime deps | Direct HTTP adapter against the documented API (avoids the narrow Node engine range; same endpoints) |
| Privy Stellar wallets | docs.privy.io (raw-sign, create-a-wallet, tier-2 recipes) | Stellar is a supported extended chain: `useCreateWallet({chainType:'stellar'})`, `useSignRawHash({chainType:'stellar', hash})` returns ed25519 signature; server `users()._get`, `utils().auth().verifyAccessToken` | Server builds tx, user signs its hash, server verifies signature against stored tx before submit |
| Privy -> Supabase RLS | Supabase third-party auth list does not include Privy | | Server verifies Privy token, maps to profile; mints short-lived Supabase JWT (`sub` = profile id) for RLS-scoped realtime reads; all writes via server |
| Testnet USDC | Paiflow guide + Circle faucet | Issuer `GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5`; SAC `CBIELTK6...DAMA` (derived with stellar-sdk) | Default on testnet; mainnet issuer must be set explicitly |
| Faucet | Friendbot | Funds new accounts with test XLM | Friendbot for activation; treasury (Circle-faucet funded) for USDC and repeat XLM |
| Blend (yield) | github.com/blend-capital/blend-contracts-v2 (audits folder: Code4rena, Certora), blend-utils `testnet.contracts.json` | Pool `submit(from, spender, to, requests)`; RequestType Supply=0 Withdraw=1; b_rate 12 decimals; testnet pool uses Blend's own test USDC | Non-custodial direct supply from user wallet; APY measured from on-chain b_rate history; off by default |
| Stellar CLI deploy | developers.stellar.org cookbook | `stellar contract build/upload/deploy`, constructor args after `--` | `ops/deployer/scripts/deploy-testnet.mjs` |
| soroban-sdk | crates.io | 29.0.1 latest stable (30 is RC) | Pinned 29.0.1; adjust if testnet protocol requires |

Network note: the build environment used to write this code could not reach Stellar testnet or Paiflow (egress allowlist), so no live transactions were executed during development. All live steps are scripted for the owner to run.
