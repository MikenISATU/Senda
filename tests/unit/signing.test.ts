import { beforeAll, describe, expect, it } from "vitest";
import { Account, Keypair, Networks, Operation, Asset, TransactionBuilder } from "@stellar/stellar-sdk";

beforeAll(() => {
  process.env.STELLAR_NETWORK = "testnet";
});

function unsigned(source: Keypair) {
  return new TransactionBuilder(new Account(source.publicKey(), "41"), { fee: "1000", networkPassphrase: Networks.TESTNET })
    .setTimeout(180)
    .addOperation(Operation.payment({ destination: Keypair.random().publicKey(), asset: Asset.native(), amount: "1" }))
    .build();
}

describe("attachSignature (Privy raw-hash signature -> Stellar envelope)", () => {
  it("accepts a valid ed25519 signature over the stored hash", async () => {
    const { attachSignature } = await import("@/lib/stellar/tx");
    const kp = Keypair.random();
    const tx = unsigned(kp);
    const sigHex = "0x" + Buffer.from(kp.sign(tx.hash())).toString("hex");
    const signed = attachSignature(tx.toXDR(), kp.publicKey(), sigHex);
    expect(signed.signatures).toHaveLength(1);
    expect(Buffer.from(signed.hash()).toString("hex")).toBe(Buffer.from(tx.hash()).toString("hex"));
  });
  it("rejects a signature from another key", async () => {
    const { attachSignature } = await import("@/lib/stellar/tx");
    const kp = Keypair.random();
    const tx = unsigned(kp);
    const other = Keypair.random();
    const sigHex = "0x" + Buffer.from(other.sign(tx.hash())).toString("hex");
    expect(() => attachSignature(tx.toXDR(), kp.publicKey(), sigHex)).toThrow(/does not match/);
  });
  it("rejects a signature over a different transaction", async () => {
    const { attachSignature } = await import("@/lib/stellar/tx");
    const kp = Keypair.random();
    const a = unsigned(kp);
    const b = unsigned(kp);
    const sigHex = "0x" + Buffer.from(kp.sign(b.hash())).toString("hex");
    expect(() => attachSignature(a.toXDR(), kp.publicKey(), sigHex)).toThrow();
  });
  it("rejects malformed signatures", async () => {
    const { attachSignature } = await import("@/lib/stellar/tx");
    const kp = Keypair.random();
    expect(() => attachSignature(unsigned(kp).toXDR(), kp.publicKey(), "0x1234")).toThrow(/Malformed/);
  });
});
