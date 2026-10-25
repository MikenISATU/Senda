# Senda contract deployer

Deploys `contracts/job_escrow` (and optionally the experimental vault) to **Stellar testnet** and records a manifest. Mainnet is a printed plan only.

## Secrets policy

- The deployer's secret key **never** lives in this repo, in `.env` files, in the PDF, in logs, in CI artifacts, in Supabase, or in the browser bundle.
- It lives in the **Stellar CLI identity store**. Use `--secure-store` so the CLI keeps it in your OS keychain (Windows Credential Manager, macOS Keychain, Secret Service on Linux). If your CLI version lacks that flag, the key sits in the CLI's config folder in your user profile, still outside the repo.
- `ops/deployer/.env` holds **names and public addresses only**. The scripts refuse to read any variable named `*SECRET*`, `*SEED*` or `*PRIVATE*` from it.
- Testnet and mainnet use **different identities**. Never reuse the testnet deployer on mainnet.
- Nobody should ever paste a seed phrase or secret key into chat, an issue, or a document.

## One-time setup

```powershell
# 1. Tools
rustup target add wasm32v1-none
stellar --version            # install: see START_HERE.md section 1

# 2. Testnet deployer identity (secret stays in your keychain)
stellar keys generate senda-testnet-deployer --network testnet --fund --secure-store
stellar keys address senda-testnet-deployer   # public key, safe to share

# 3. Non-secret config
Copy-Item ops/deployer/.env.example ops/deployer/.env
# edit ops/deployer/.env: set ESCROW_MEDIATOR and FEE_COLLECTOR_ADDRESS to your Senda wallet address
```

## Deploy to testnet

```powershell
pnpm contracts:deploy:testnet      # = node ops/deployer/scripts/deploy-testnet.mjs
pnpm contracts:verify              # = node ops/deployer/scripts/verify.mjs
```
macOS/Linux/Git Bash can also run `ops/deployer/scripts/deploy-testnet.sh` and `verify.sh`.

The deploy script: refuses non-testnet networks > runs `cargo test` (stops on failure) > `stellar contract build` > records the wasm SHA-256 > resolves the XLM and USDC asset contracts > uploads the wasm > deploys with constructor arguments > writes `manifests/testnet-<timestamp>.json` > prints the `.env.local` lines to paste.

`verify.mjs` downloads the on-chain wasm and checks its SHA-256 equals the manifest, then reads `get_config` and the token allow-list by simulation (no fee).

## Current testnet deployment (2026-10-24)

| Contract | Id |
|---|---|
| job_escrow | `CAPHY7BPH7T374NWFHZSSYEU24URTGREWW7XNSPENKALSPUJFIFVDUUN` |
| usdc_earn_vault | `CCHVH2MXKFSKC5WCWMGL3GGMPKA37UZTCJTUSLQMJDOKDFD6AOXURV67` |

Platform wallets (testnet):

| Wallet | Address | Secret |
|---|---|---|
| Deployer / admin / guardian / mediator / fee collector | `GCWPFDF44ISIKDKC6I4KCV6LP3BHHG55JWGEZJE4NTI4O6Q4ZPGF66SX` | `secrets/testnet-deployer.secret` (git-ignored) |
| Faucet treasury (also Paiflow split "Treasury" 80%) | `GAJFQEBCRMK6REOVYEJRJKFFX3E5AONAO4M5HPL3SVPVQ7HLG5FYYNCO` | `secrets/faucet-treasury.secret`; also `FAUCET_TREASURY_SECRET` in `.env.local` |
| Senda Community (Paiflow split "Community" 20%) | `GAASQI4VUVKFQTV3Y2T7FX6LSRL4OXKKDLWKALJXPRUTTXVPFB2XLRF5` | `secrets/community-wallet.secret` |

All three have the testnet USDC trustline. Full record, transaction hashes and a live escrow test: `manifests/testnet-2026-10-24T14-51-22-296Z.json`.

Testnet rent is currently high: uploading the 18.8 KB escrow code cost about 235 test XLM, so keep the deployer funded (Friendbot) before redeploying.

## Manifest fields

`release`, `network`, `networkPassphrase`, `deployerPublicKey`, `sourceCommit`, `deployedAt`, asset contract ids, and per contract: `contractId`, `wasmSha256`, `wasmHash`, `uploadTx`, `deployTx`, `explorer`, constructor arguments and a plain-language `permissions` summary. No secret material.

## Roles and permissions (job_escrow)

| Role | Can | Cannot |
|---|---|---|
| admin | change fee (new jobs only, max 10%), review period, roles, token allow-list; propose/execute upgrade after a 7-day timelock; two-step admin handover | move or release escrowed funds |
| guardian | pause **new funding** | stop refunds, approvals or dispute exits; move funds |
| mediator (snapshotted per job at funding) | split a **disputed** job between client and freelancer | pay itself or anyone else; act on jobs funded under a previous mediator |
| anyone | trigger refund after deadline (funds go to the client); the fallback for a dispute ignored 30 days (freelancer paid if proof was pending, else client refunded) | anything else |

On mainnet, admin should be a multisig account (e.g. 2-of-3 on hardware wallets), with guardian and mediator as separate keys.

## Testnet to mainnet dry-run checklist

Run `pnpm contracts:mainnet-plan`. It prints this checklist and the exact commands; it executes nothing.

1. Independent audit of `job_escrow` done, findings fixed, audited wasm SHA-256 recorded.
2. `verify.mjs` passes on testnet for the exact release commit.
3. Full testnet E2E: fund, proof, revision, approve, claim after review, refund after deadline, freelancer cancel, dispute + mediator resolve, mutual settlement, stale dispute.
4. Mainnet admin multisig created and tested; guardian and mediator keys separate.
5. Mainnet USDC issuer copied from Circle's official documentation (not the testnet one).
6. Legal review: escrow, fees, mediation terms, licensing in launch markets.
7. `FAUCET_ENABLED=false`, `USDC_AUTO_EARN_ENABLED=false` unless separately approved.
8. Written sign-off from the project owner with date and commit hash.

## Rollback and pause procedure

1. **Incident**: guardian calls `pause` (`stellar contract invoke --id <C...> --source <guardian> --network <net> -- pause --by <guardian G...>`). New funding stops immediately. Existing jobs can still be approved, refunded, cancelled or resolved, so no funds are trapped.
2. **Fix**: build the patched wasm, get it reviewed, upload it, and `propose_upgrade --wasm_hash <hash>`. Users have 7 days to exit before `execute_upgrade` can run. `cancel_upgrade` aborts.
3. **App side**: set `SOROBAN_JOB_ESCROW_CONTRACT_ID` to the old contract until the fix is live; the UI keeps reading on-chain state for existing jobs.
4. **Resume**: admin calls `unpause` after the fix is verified with `verify.mjs`.
