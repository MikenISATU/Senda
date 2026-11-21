/**
 * Live end-to-end checks on Stellar testnet.
 *
 * Every payment and job step the app offers is built here with the SAME
 * server code the app uses (lib/server/fees.ts, lib/server/escrow.ts), signed
 * the way the app signs (a raw signature over the transaction hash, attached
 * and verified by attachSignature), and sent to the deployed contracts. The
 * only stand-in is the key: fresh test wallets sign instead of a Senda login.
 *
 * Run: pnpm test:live
 * Needs: SOROBAN_FEE_SPLITTER_CONTRACT_ID and SOROBAN_JOB_ESCROW_CONTRACT_ID.
 * Optional: LIVE_MEDIATOR_SECRET (the escrow mediator key) to also run the
 * dispute-ruling step, and LIVE_USDC_FUNDER_SECRET (any wallet holding test
 * USDC) to also run the USDC steps. Both are skipped without their key.
 * Uses free test money only.
 */
import { createHash, randomUUID } from "node:crypto";
import { Keypair, type Transaction } from "@stellar/stellar-sdk";
import { beforeAll, describe, expect, it } from "vitest";
import { buildActionTx, buildFundTx, escrowContractId, escrowSalt, onchainJobId, readOnchainJob, type EscrowAction } from "@/lib/server/escrow";
import { buildDistributeTx, buildPay, feeConfig, splitterId, splitterOverview } from "@/lib/server/fees";
import { getBalances } from "@/lib/stellar/account";
import { toStroops } from "@/lib/stellar/amount";
import { asset, assetContractId } from "@/lib/stellar/network";
import { assertCanSwap, quoteSwap } from "@/lib/server/swap";
import { attachSignature, buildChangeTrustTx, buildPaymentTx, buildSwapTx, submitClassic, submitSoroban } from "@/lib/stellar/tx";

const XLM = (n: number) => BigInt(Math.round(n * 1e7));
const formatAmountPlain = (stroops: bigint) => `${stroops / 10_000_000n}.${String(stroops % 10_000_000n).padStart(7, "0")}`;
const log: string[] = [];

async function fresh(): Promise<Keypair> {
  const kp = Keypair.random();
  for (let i = 0; i < 3; i++) {
    const r = await fetch(`https://friendbot.stellar.org/?addr=${kp.publicKey()}`);
    if (r.ok) return kp;
    await new Promise((res) => setTimeout(res, 2000));
  }
  throw new Error("Friendbot did not fund the test wallet");
}

/** Sign exactly like the app: raw ed25519 signature over the hash, then attachSignature verifies it. */
async function signAndSend(tx: Transaction, kp: Keypair, label: string, classic = false) {
  const sig = `0x${Buffer.from(kp.sign(tx.hash())).toString("hex")}`;
  const signed = attachSignature(tx.toXDR(), kp.publicKey(), sig);
  const r = classic ? await submitClassic(signed) : await submitSoroban(signed, 60_000);
  log.push(`${label}: ${r.status} ${r.hash}`);
  expect(r.status, `${label} ${"error" in r ? r.error : ""}`).toBe("confirmed");
  return r.hash;
}

const xlm = async (addr: string) => toStroops((await getBalances(addr)).xlm);

async function fundJob(client: Keypair, freelancer: Keypair, amount: bigint, deadlineInSecs: number) {
  const salt = escrowSalt(randomUUID(), escrowContractId());
  const key = onchainJobId(client.publicKey(), salt);
  const tx = await buildFundTx({ client: client.publicKey(), freelancer: freelancer.publicKey(), salt, token: assetContractId("XLM"), amount, deadlineUnix: Math.floor(Date.now() / 1000) + deadlineInSecs });
  await signAndSend(tx, client, "job fund");
  const job = await readOnchainJob(key);
  expect(job?.status).toBe("Funded");
  return key;
}
const act = async (kp: Keypair, key: string, a: EscrowAction) => signAndSend(await buildActionTx(kp.publicKey(), key, a), kp, `job ${a.action}`);
const status = async (key: string) => (await readOnchainJob(key))?.status;

describe("live testnet: contracts cover every money feature in the app", () => {
  let alice: Keypair, ben: Keypair, cara: Keypair;
  let treasury: string, community: string;

  beforeAll(async () => {
    expect(splitterId(), "SOROBAN_FEE_SPLITTER_CONTRACT_ID").toBeTruthy();
    [alice, ben, cara] = await Promise.all([fresh(), fresh(), fresh()]);
    const cfg = await feeConfig(true);
    expect(cfg).toBeTruthy();
    expect(cfg!.paused).toBe(false);
    expect(cfg!.shares.reduce((n, s) => n + s.bps, 0)).toBe(10_000);
    [treasury, community] = [cfg!.shares[0].to, cfg!.shares[1].to];
  });

  it.each([
    ["send", 50],
    ["tip", 250],
    ["purchase", 250],
  ] as const)("%s: recipient gets the rest, fee splits 80/20, in one transaction", async (kind, bps) => {
    const gross = XLM(10);
    const [b0, t0, c0] = await Promise.all([xlm(ben.publicKey()), xlm(treasury), xlm(community)]);
    const p = await buildPay({ from: alice.publicKey(), to: ben.publicKey(), code: "XLM", gross, kind });
    expect(p.provider).toBe("soroban");
    expect(p.bps).toBe(bps);
    await signAndSend(p.tx, alice, `pay ${kind}`);
    const [b1, t1, c1] = await Promise.all([xlm(ben.publicKey()), xlm(treasury), xlm(community)]);
    const fee = (gross * BigInt(bps)) / 10_000n;
    expect(b1 - b0).toBe(gross - fee);
    expect(p.net).toBe(gross - fee);
    expect(c1 - c0).toBe((fee * 2000n) / 10_000n);
    expect(t1 - t0).toBe(fee - (fee * 2000n) / 10_000n);
  });

  it("send to a brand-new wallet creates it (plain payment, no fee)", async () => {
    const fresh2 = Keypair.random();
    const p = await buildPay({ from: alice.publicKey(), to: fresh2.publicKey(), code: "XLM", gross: XLM(2), kind: "send", allowCreate: true });
    expect(p.provider).toBe("stellar");
    await signAndSend(p.tx, alice, "send (creates wallet)", true);
    expect(await xlm(fresh2.publicKey())).toBe(XLM(2));
  });

  it("refuses a payment larger than the balance before anything is signed", async () => {
    await expect(buildPay({ from: alice.publicKey(), to: ben.publicKey(), code: "XLM", gross: XLM(1_000_000), kind: "send" })).rejects.toThrow(/enough XLM/);
  });

  it("job: fund, proof, revision, proof again, approve; then the fee is paid out 80/20", async () => {
    const amount = XLM(20);
    const key = await fundJob(alice, ben, amount, 3600);
    const proof = createHash("sha256").update("work v1").digest("hex");
    await act(ben, key, { action: "submit_proof", proofHash: proof });
    expect(await status(key)).toBe("ProofSubmitted");
    await act(alice, key, { action: "request_revision" });
    expect(await status(key)).toBe("RevisionRequested");
    await act(ben, key, { action: "submit_proof", proofHash: createHash("sha256").update("work v2").digest("hex") });
    const b0 = await xlm(ben.publicKey());
    await act(alice, key, { action: "approve" });
    const job = await readOnchainJob(key);
    expect(job?.status).toBe("Paid");
    const fee = (amount * 250n) / 10_000n;
    expect((await xlm(ben.publicKey())) - b0).toBe(amount - fee);

    // The escrow sent its fee to the fee contract. Anyone may pay it out.
    const waiting = toStroops((await splitterOverview())!.tokens.find((t) => t.code === "XLM")!.waiting);
    expect(waiting).toBeGreaterThanOrEqual(fee);
    const [t0, c0] = await Promise.all([xlm(treasury), xlm(community)]);
    await signAndSend(await buildDistributeTx(cara.publicKey(), "XLM"), cara, "fee distribute (by a stranger)");
    const [t1, c1] = await Promise.all([xlm(treasury), xlm(community)]);
    expect(c1 - c0).toBe((waiting * 2000n) / 10_000n);
    expect(t1 - t0).toBe(waiting - (waiting * 2000n) / 10_000n);
  });

  it("job: no work by the deadline, anyone can send the full refund to the client", async () => {
    const amount = XLM(5);
    const key = await fundJob(alice, ben, amount, 20);
    await new Promise((res) => setTimeout(res, 30_000));
    const a0 = await xlm(alice.publicKey());
    await act(cara, key, { action: "refund_expired" });
    expect(await status(key)).toBe("Refunded");
    expect((await xlm(alice.publicKey())) - a0).toBe(amount);
  });

  it("job: freelancer cancels, client is refunded in full", async () => {
    const amount = XLM(5);
    const key = await fundJob(alice, ben, amount, 3600);
    const a0 = await xlm(alice.publicKey());
    await act(ben, key, { action: "cancel_by_freelancer" });
    expect(await status(key)).toBe("Refunded");
    expect((await xlm(alice.publicKey())) - a0).toBe(amount);
  });

  it("job: dispute, then both sides agree a split", async () => {
    const amount = XLM(10);
    const key = await fundJob(alice, ben, amount, 3600);
    await act(ben, key, { action: "submit_proof", proofHash: "ab".repeat(32) });
    await act(alice, key, { action: "open_dispute" });
    expect(await status(key)).toBe("Disputed");
    await act(alice, key, { action: "propose_settlement", freelancerAmount: XLM(6) });
    const b0 = await xlm(ben.publicKey());
    await act(ben, key, { action: "accept_settlement", freelancerAmount: XLM(6) });
    const job = await readOnchainJob(key);
    expect(job?.status).toBe("Resolved");
    expect(toStroops(job!.paidFreelancer) + toStroops(job!.paidFee) + toStroops(job!.refundedClient)).toBe(amount);
    expect(toStroops(job!.refundedClient)).toBe(XLM(4));
    expect((await xlm(ben.publicKey())) - b0 + XLM(0.1)).toBeGreaterThan(toStroops(job!.paidFreelancer)); // ben paid the network fee
  });

  it.skipIf(!process.env.LIVE_MEDIATOR_SECRET)("job: dispute, mediator rules a split between the two parties only", async () => {
    const mediator = Keypair.fromSecret(process.env.LIVE_MEDIATOR_SECRET!);
    const amount = XLM(10);
    const key = await fundJob(alice, ben, amount, 3600);
    await act(ben, key, { action: "open_dispute" });
    const [a0, b0] = await Promise.all([xlm(alice.publicKey()), xlm(ben.publicKey())]);
    await act(mediator, key, { action: "resolve_dispute", freelancerAmount: XLM(7) });
    const job = await readOnchainJob(key);
    expect(job?.status).toBe("Resolved");
    expect(toStroops(job!.refundedClient)).toBe(XLM(3));
    expect((await xlm(alice.publicKey())) - a0).toBe(XLM(3));
    expect((await xlm(ben.publicKey())) - b0).toBe(toStroops(job!.paidFreelancer));
    expect(toStroops(job!.paidFreelancer) + toStroops(job!.paidFee)).toBe(XLM(7));
  });

  it("job: a stranger cannot release the money; the client can release early", async () => {
    const amount = XLM(5);
    const key = await fundJob(alice, ben, amount, 3600);
    // A stranger can build the call, but the network refuses it without the client's signature.
    const tx = await buildActionTx(cara.publicKey(), key, { action: "approve" }).catch(() => null);
    if (tx) {
      const signed = attachSignature(tx.toXDR(), cara.publicKey(), `0x${Buffer.from(cara.sign(tx.hash())).toString("hex")}`);
      const r = await submitSoroban(signed, 60_000).catch((e: Error) => ({ status: "failed" as const, hash: "", error: e.message }));
      expect(r.status).toBe("failed");
    }
    expect(await status(key)).toBe("Funded");
    const b0 = await xlm(ben.publicKey());
    await act(alice, key, { action: "approve" });
    expect(await status(key)).toBe("Paid");
    expect((await xlm(ben.publicKey())) - b0).toBe(amount - (amount * 250n) / 10_000n);
  });

  it.skipIf(!process.env.LIVE_USDC_FUNDER_SECRET)("USDC: buy a Premium post priced at $2, then a full USDC job", async () => {
    const funder = Keypair.fromSecret(process.env.LIVE_USDC_FUNDER_SECRET!);
    const usdc = async (a: string) => toStroops((await getBalances(a)).usdc ?? "0");
    // Turn on USDC the way the app does, then give the buyer some test dollars.
    for (const kp of [alice, ben]) await signAndSend(await buildChangeTrustTx(kp.publicKey(), asset("USDC")), kp, "turn on USDC", true);
    await signAndSend(await buildPaymentTx(funder.publicKey(), [{ destination: alice.publicKey(), asset: asset("USDC"), stroops: XLM(8) }]), funder, "fund buyer with test USDC", true);

    // Premium post at the seller's price: creator gets 97.5%, fee splits 80/20.
    const price = toStroops("2");
    const [b0, t0, c0] = await Promise.all([usdc(ben.publicKey()), usdc(treasury), usdc(community)]);
    const p = await buildPay({ from: alice.publicKey(), to: ben.publicKey(), code: "USDC", gross: price, kind: "purchase", memo: "Senda purchase" });
    await signAndSend(p.tx, alice, "buy premium post ($2 USDC)");
    const [b1, t1, c1] = await Promise.all([usdc(ben.publicKey()), usdc(treasury), usdc(community)]);
    expect(b1 - b0).toBe(XLM(1.95));
    expect(t1 - t0).toBe(XLM(0.04));
    expect(c1 - c0).toBe(XLM(0.01));

    // A job paid in USDC.
    const amount = XLM(4);
    const salt = escrowSalt(randomUUID(), escrowContractId());
    const key = onchainJobId(alice.publicKey(), salt);
    await signAndSend(await buildFundTx({ client: alice.publicKey(), freelancer: ben.publicKey(), salt, token: assetContractId("USDC"), amount, deadlineUnix: Math.floor(Date.now() / 1000) + 3600 }), alice, "USDC job fund");
    await act(ben, key, { action: "submit_proof", proofHash: "ef".repeat(32) });
    const f0 = await usdc(ben.publicKey());
    await act(alice, key, { action: "approve" });
    expect(await status(key)).toBe("Paid");
    expect((await usdc(ben.publicKey())) - f0).toBe(XLM(3.9));
    const [t2, c2] = await Promise.all([usdc(treasury), usdc(community)]);
    await signAndSend(await buildDistributeTx(cara.publicKey(), "USDC"), cara, "USDC fee distribute");
    const [t3, c3] = await Promise.all([usdc(treasury), usdc(community)]);
    expect(t3 - t2 + (c3 - c2)).toBeGreaterThanOrEqual(XLM(0.1));
  });

  it("swap: XLM to USDC and back inside one wallet, never below the promised minimum", async () => {
    const dana = await fresh();
    const usdc = async () => toStroops((await getBalances(dana.publicKey())).usdc ?? "0");

    // Without USDC turned on, the app refuses before anything is signed.
    const early = await quoteSwap("XLM", "50");
    await expect(assertCanSwap(dana.publicKey(), early)).rejects.toThrow(/Turn on USDC/);

    await signAndSend(await buildChangeTrustTx(dana.publicKey(), asset("USDC")), dana, "swap: turn on USDC", true);

    const q1 = await quoteSwap("XLM", "50");
    expect(q1.to).toBe("USDC");
    expect(q1.minReceive).toBeLessThan(q1.receive);
    await assertCanSwap(dana.publicKey(), q1);
    const x0 = await xlm(dana.publicKey());
    await signAndSend(await buildSwapTx(dana.publicKey(), { send: asset("XLM"), sendStroops: q1.send, receive: asset("USDC"), minReceiveStroops: q1.minReceive, path: q1.path }), dana, "swap XLM to USDC", true);
    const got = await usdc();
    expect(got).toBeGreaterThanOrEqual(q1.minReceive);
    expect(x0 - (await xlm(dana.publicKey()))).toBeGreaterThanOrEqual(q1.send); // the amount plus the tiny network fee

    const q2 = await quoteSwap("USDC", formatAmountPlain(got / 2n));
    await assertCanSwap(dana.publicKey(), q2);
    const x1 = await xlm(dana.publicKey());
    await signAndSend(await buildSwapTx(dana.publicKey(), { send: asset("USDC"), sendStroops: q2.send, receive: asset("XLM"), minReceiveStroops: q2.minReceive, path: q2.path }), dana, "swap USDC to XLM", true);
    expect((await usdc())).toBe(got - q2.send);
    expect((await xlm(dana.publicKey())) - x1 + XLM(0.01)).toBeGreaterThanOrEqual(q2.minReceive);

    // More than the wallet holds is refused up front.
    await expect(assertCanSwap(dana.publicKey(), await quoteSwap("XLM", "999999"))).rejects.toThrow(/You can swap up to/);
  });

  it("writes the transaction log", async () => {
    const { writeFileSync } = await import("node:fs");
    if (process.env.LIVE_LOG_FILE) writeFileSync(process.env.LIVE_LOG_FILE, log.join("\n") + "\n");
    expect(log.length).toBeGreaterThan(0);
  });
});
