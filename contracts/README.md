# Senda Soroban contracts

| Crate | Purpose | Status |
|---|---|---|
| `shared` | Checked fee math, TTL constants, upgrade record | tested |
| `fee_splitter` | Pays the recipient and splits Senda's fee between the treasury and community wallets in one transaction (`pay`); pays out job fees the escrow sends it (`distribute`, open to anyone) | 13 tests incl. property tests; live on testnet |
| `job_escrow` | Funded freelance escrow: proof, revision, approve, refund, dispute, timelocked upgrade, guardian pause (new funding only). Its fee goes to `fee_splitter` | 23 tests incl. property tests; live on testnet |
| `usdc_earn_vault` | Pooled share vault over an audited Blend v2 pool. **Unaudited: testnet only.** When `SOROBAN_USDC_EARN_VAULT_CONTRACT_ID` is set the app's Earn goes through it; otherwise users supply to Blend directly. | 7 tests incl. property test; mainnet blocked unless `EARN_VAULT_AUDITED=true` |

The treasury and community wallets are plain Stellar accounts (use multisig accounts on mainnet). `fee_splitter` only ever sends to them; it never holds user money.

## Commands

```bash
cargo test                       # native unit + property tests
stellar contract build           # builds target/wasm32v1-none/release/*.wasm
```

`stellar contract build` needs the `wasm32v1-none` target: `rustup target add wasm32v1-none`.

## Escrow invariants (enforced by tests)

1. Only allow-listed tokens; exactly `amount` is pulled from the client when funding.
2. Job ids are `sha256(client_xdr || salt)` computed on-chain, so nobody can squat another client's job; an id funds once and a terminal job never pays again.
3. For every terminal job: `paid_freelancer + paid_fee + refunded_client == amount`.
4. `total_locked(token) == contract token balance == sum of open job amounts` after every call.
5. No function lets admin, guardian or mediator route escrowed funds to themselves. The mediator is snapshotted per job at funding and only splits between client and freelancer. (The admin can still upgrade code after a 7-day public timelock: use a multisig.)
6. Pause blocks new funding only. Approve, refund, cancel and dispute exits keep working.
7. Fee is snapshotted at funding (max 10%); later fee changes do not touch existing jobs.
8. Upgrades are two-step with a 7-day timelock; admin handover is two-step.
9. Proof must arrive by the deadline. If the client ignores submitted proof for the review window, the freelancer can claim. If no proof arrives by the deadline, anyone can trigger the refund to the client. If the mediator ignores a dispute for 30 days, anyone can trigger the fallback: freelancer paid if proof was pending review when the dispute opened, otherwise client refunded.
10. Settlement proposals are cleared whenever the job changes state (new proof, revision, dispute).

## Fee splitter invariants (enforced by tests)

1. `pay` moves exactly `amount` out of the payer: recipient share + every fee share = amount. The contract's own balance is never used.
2. The fee rate is read from the contract by payment kind (send, tip, purchase) and capped at 10%.
3. Fee shares always total 100%; the last recipient absorbs rounding dust, so nothing is lost.
4. Only allow-listed tokens. Only the payer can authorise a `pay`.
5. `distribute` hands out the contract's whole balance by share and can be called by anyone, even while `pay` is paused.
6. Only the admin can change rates, recipients or tokens; admin handover is two-step; upgrades wait 7 days.

## Vault invariants (enforced by tests)

1. Yield only comes from the strategy's b_rate. New deposits never raise existing users' value.
2. Strategy losses reduce every share's value pro rata.
3. Shares are minted from the amount the strategy actually credited (protects against rounding/donation games).
4. Without strategy accrual, nobody withdraws more than they deposited.
5. Pause blocks deposits only; withdrawals stay open (subject to pool liquidity).
