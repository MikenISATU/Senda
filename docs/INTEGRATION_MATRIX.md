# Integration matrix (verified 24 Oct 2026)

| Integration | Source checked | Finding | Senda decision |
|---|---|---|---|
| Privy Stellar wallets | docs.privy.io (raw-sign, create-a-wallet, tier-2 recipes) | Stellar is a supported extended chain: `useCreateWallet({chainType:'stellar'})`, `useSignRawHash({chainType:'stellar', hash})` returns ed25519 signature; server `users()._get`, `utils().auth().verifyAccessToken` | Server builds tx, user signs its hash, server verifies signature against stored tx before submit |
| Privy -> Supabase RLS | Supabase third-party auth list does not include Privy | | Server verifies Privy token, maps to profile; mints short-lived Supabase JWT (`sub` = profile id) for RLS-scoped realtime reads; all writes via server |
| Testnet USDC | Circle faucet | Issuer `GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5`; SAC `CBIELTK6...DAMA` (derived with stellar-sdk) | Default on testnet; mainnet issuer must be set explicitly |
| Faucet | Friendbot | Funds new accounts with test XLM | Friendbot for activation; treasury (Circle-faucet funded) for USDC and repeat XLM |
| Blend (yield) | github.com/blend-capital/blend-contracts-v2 (audits folder: Code4rena, Certora), blend-utils `testnet.contracts.json` | Pool `submit(from, spender, to, requests)`; RequestType Supply=0 Withdraw=1; b_rate 12 decimals; testnet pool uses Blend's own test USDC | Non-custodial direct supply from user wallet; APY measured from on-chain b_rate history; off by default |
| Stellar CLI deploy | developers.stellar.org cookbook | `stellar contract build/upload/deploy`, constructor args after `--` | `ops/deployer/scripts/deploy-testnet.mjs` |
| soroban-sdk | crates.io | 29.0.1 | Pinned 29.0.1; contracts built with it run on testnet protocol 30 (checked 14 Nov 2026) |

