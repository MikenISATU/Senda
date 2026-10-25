# Paiflow setup for Senda

Research date: 24 Oct 2026. Sources: the Paiflow repo (`develop` branch) `docs/api/README.md`, `packages/sdk/README.md` (SDK 0.2.0), `docs/hackathon/paiflow-guide.md`, and the public instance `https://beta.app.paiflow.xyz` (testnet).

## What Paiflow can and cannot do (verified from its docs)

- A Paiflow **flow** is drawn in the visual builder and deployed as Stellar contracts. Blocks: triggers **On Receive**, **On Schedule**, **HTTP Webhook**, **Subscription**, **Payroll**; actions **Pay**, **Split**, **Swap**; logic **Condition**.
- Your backend can **execute** only flows that start with **On Receive**: `prepare` (unsigned deposit) > the payer's wallet signs > `submit`. Then you read decoded **events** and look up a **transaction** by hash.
- **Recipients are fixed at deploy time.** Per-payment recipients ("Dev mode", "Fill value via API") are disabled on the hosted beta. One deployment = one set of payees.
- Flows and deployments **cannot be created through the API**. Each one is built and deployed by hand in the dashboard and signed by a wallet.
- Paiflow does **not** send signed webhooks to your app. "HTTP Webhook" is a trigger where *your* server calls *Paiflow* with `x-webhook-secret` to release a pre-funded pool.
- Timelock/escrow-style flows release early through Paiflow's **relayer** using an API token, which means whoever holds the token can release.

## How Senda uses Paiflow (simple version)

Paiflow flows pay **fixed** recipients set when you deploy, so they can't send to a different person each time. Senda therefore splits the work like this:

| What happens in Senda | How it works | Paiflow? |
|---|---|---|
| Send money, request money in a direct chat, receive | A direct payment the payer approves; the recipient receives the full amount and Senda takes no fee | No |
| Tips and paid posts | One atomic payment with two parts: the creator's share and the platform fee | No |
| Job payments | Held in Senda's job escrow contract; the freelancer receives the amount minus the platform fee only after an authorized payout | No |
| **Platform fees** | Collected in the fee-collector wallet, then sent through Paiflow to your fixed treasury wallets | **Yes, 2 flows** |

Before a user signs a Paiflow-prepared transaction, Senda checks it is exactly one `deposit(from, amount)` call from that user, on the right network. Events are pulled with the token, deduplicated by `eventId`, and only marked verified when Paiflow's transaction lookup reports `SUCCESS`.

## Your two flows: exact setup

Build **two** flows. Both are the same shape, **On Receive > Split**, with no Condition, Pay, Hold or Swap blocks.

| Paiflow flow name | On Receive asset | Split recipients (example, must total 100%) | Paste the deployment UUID into |
|---|---|---|---|
| `SENDA_FEES_USDC` | USDC (issuer `GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5`) | Treasury 80%, Community 20% | `PAIFLOW_FEES_USDC_WORKFLOW_ID` |
| `SENDA_FEES_XLM` | XLM (native) | Treasury 80%, Community 20% | `PAIFLOW_FEES_XLM_WORKFLOW_ID` |

You can delete the older flows (SENDA_JOB_PAYMENT, SENDA_POST_PURCHASE, SENDA_CREATOR_TIPS, SENDA_RECEIVE_PAYMENT, SENDA_SEND_PAYMENT), or rename two of them and reuse them if they already match the shape above.

For each flow:
1. Open the flow in the builder. Remove every block except **On Receive** and **Split**, and connect On Receive > Split.
2. Click **On Receive** and set the asset (USDC, or XLM). Leave minimum amount empty.
3. Click **Split**, choose **Percentage**, and enter real `G...` addresses for your recipients (shares total 100%). **Every recipient of the USDC flow needs a USDC trustline**, or the payout reverts. Keep **Dev mode off**.
4. Check the **English preview** reads like "When this contract receives USDC, split it ...". Connect your wallet (Testnet), **Deploy**, and wait for **CONFIRMED**.
5. Copy the **deployment UUID** from the deployment page URL (`/deployments/<uuid>`). Not the flow name and not the `C...` contract address.
6. Under **Developer API**, create one token with **Read and operate** that includes both deployments. Copy the `pfd_...` token once.
7. Put it in `.env.local` and restart `pnpm dev`:
   ```dotenv
   PAIFLOW_API_KEY=pfd_...
   PAIFLOW_FEES_USDC_WORKFLOW_ID=<SENDA_FEES_USDC uuid>
   PAIFLOW_FEES_XLM_WORKFLOW_ID=<SENDA_FEES_XLM uuid>
   ```
8. Check: **Admin > Paiflow workflows** lists `FEES_USDC` and `FEES_XLM` with `execute: supported`. To sweep, sign in with the fee-collector wallet, choose **USDC fees** or **XLM fees**, enter an amount and approve.

## Build the fee-split flow (detailed walkthrough)

You need: a desktop browser, the **Freighter** extension, and a Google account.

### 1. Prepare testnet wallets in Freighter
1. Install Freighter (freighter.app), create a wallet, and switch it to **Testnet** (settings > Network).
2. Create three accounts in Freighter and label them **Deployer**, **Treasury**, **Community**. Fund each with **Friendbot** in Freighter.
3. On **Treasury** and **Community**, add the USDC trustline: Freighter > Manage assets > Add manually > code `USDC`, issuer `GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5`. A missing trustline makes the whole payout revert.

### 2. Sign in to Paiflow
1. Open https://beta.app.paiflow.xyz and choose **Continue with Google**.
2. If asked for an **Access code**, use the one Paiflow or your event organiser gave you. Do not use the "Try the sandbox" identity: sandbox accounts can't create API tokens.

### 3. Draw the flow
1. Create a new flow. Name it `Senda fee split (USDC)`.
2. Drag **On Receive** onto the canvas as the trigger. Set its asset to **USDC** and confirm the issuer is `GBBD47...FLA5`.
3. Drag **Split** onto the canvas and connect **On Receive > Split**.
4. In Split, choose percentage mode and add two recipients with your real public addresses, for example **Treasury 80%** and **Community 20%** (must total 100%). Use two different addresses.
5. Remove any example blocks or placeholder recipients. Keep **Dev mode off**.

### 4. Review and deploy
1. Open the deployment review and read the **English preview**: it should say it receives USDC and splits it to your two addresses at your percentages.
2. Connect the **Deployer** account in Freighter (Testnet). Start deployment and approve in Freighter after checking the network, account and fee.
3. Wait for status **CONFIRMED**, then open the deployment page.
4. Copy the **deployment UUID** from the URL (`/deployments/<uuid>`). This is your workflow id. It is not the flow id and not the `C...` contract address.

### 5. Test it once in Paiflow
Open `https://beta.app.paiflow.xyz/trigger/<uuid>`, connect a funded USDC test account, pay **1 USDC**, and check the payouts (0.8 / 0.2) in the deployment's activity and on stellar.expert.

### 6. Create the API token
1. Go to **Developer API** (`https://beta.app.paiflow.xyz/account/developer`).
2. **Create developer token**: label `senda-server`, pick an expiry, choose **Read and operate**, select your fee-split deployment.
3. Copy the `pfd_...` token immediately (shown once).
   Alternative: the deployment page's **API access** panel creates a single-deployment `pfk_...` token.

### 7. Paste into `.env.local`
```dotenv
PAIFLOW_API_BASE_URL=https://beta.app.paiflow.xyz
PAIFLOW_API_KEY=pfd_...your token...
PAIFLOW_FEES_USDC_WORKFLOW_ID=<deployment uuid>
```
Restart `pnpm dev`. Never prefix these with `NEXT_PUBLIC_`.

### 8. Verify in Senda
1. Make sure `FEE_COLLECTOR_ADDRESS` is **your own Senda wallet address** and your profile is admin (START_HERE section 7).
2. Open **Admin > Paiflow workflows**. FEES_USDC should show trigger `on_receive` (or similar) and `execute: supported`. An error here quotes Paiflow's message.
3. After some tips or sales have paid fees into your wallet, enter an amount under **Sweep fees through** and choose **Review sweep**. Senda asks Paiflow to prepare the deposit, checks it, you approve it with your Senda wallet, and Paiflow splits it to Treasury and Community.
4. Choose **Sync events** to pull the payout events. Each shows **verified** once Paiflow confirms the transaction.
