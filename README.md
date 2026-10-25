# Senda

Send money. Share moments.

Senda is a social wallet on Stellar. Sign in with your email, pay friends by username, tip creators, sell paid posts, and hire people with payments held safely until the work is approved. Platform fees are split to treasury wallets through Paiflow. Testnet preview with free test money.

## Docs

- **docs/PAIFLOW_SETUP.md**: the two fee-split flows
- **docs/CHECKLIST.md**: what is done and what to verify
- **docs/SECURITY.md**: how money moves and what Senda can and cannot do
- **contracts/README.md** and **ops/deployer/README.md**: the job escrow contract and testnet deployment

## Layout

```
src/app          pages and API routes
src/lib/server   auth, payments, escrow, faucet, Paiflow (server only)
src/lib/stellar  amounts, network, transaction building
supabase/        database schema, functions, row security
contracts/       Soroban contracts (job_escrow, usdc_earn_vault)
ops/deployer/    deploy and verify scripts, manifests
tests/, e2e/     unit, database and browser tests
```

## Checks

```
pnpm typecheck && pnpm test && pnpm test:e2e
```
