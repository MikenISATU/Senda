import { afterEach, describe, expect, it, vi } from "vitest";
import { Account, Address, Contract, Keypair, Networks, TransactionBuilder, nativeToScVal, Operation, Asset } from "@stellar/stellar-sdk";
import { PaiflowAdapter, assertPaiflowDeposit, PaiflowError } from "@/lib/server/paiflow";

const TOKEN = "pfd_" + "a".repeat(64);
const DEP = "6b1f0c52-3d4e-4a8b-9c7d-2e5f8a1b3c4d";
const TRIGGER = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";

function depositTx(from: string, amount: bigint, fn = "deposit") {
  return new TransactionBuilder(new Account(from, "1"), { fee: "100", networkPassphrase: Networks.TESTNET })
    .setTimeout(180)
    .addOperation(new Contract(TRIGGER).call(fn, new Address(from).toScVal(), nativeToScVal(amount, { type: "i128" })))
    .build();
}

afterEach(() => vi.restoreAllMocks());

describe("PaiflowAdapter", () => {
  it("refuses non-https or path-bearing base URLs and bad tokens", () => {
    expect(() => new PaiflowAdapter("http://beta.app.paiflow.xyz", TOKEN)).toThrow();
    expect(() => new PaiflowAdapter("https://beta.app.paiflow.xyz/api", TOKEN)).toThrow();
    expect(() => new PaiflowAdapter("https://beta.app.paiflow.xyz", "pkdev_123")).toThrow();
  });

  it("prepare sends amount as stroop string and returns the history id", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: { xdr: "AAA", networkPassphrase: Networks.TESTNET, network: "testnet", expiresAt: "2026-10-24T00:00:00Z" } }), {
        status: 200,
        headers: { "x-history-request-id": "11111111-1111-1111-1111-111111111111" },
      }),
    );
    const a = new PaiflowAdapter("https://beta.app.paiflow.xyz", TOKEN);
    const p = await a.prepare(DEP, { amountStroops: 10_000_000n, from: "GABC" });
    expect(p.preparationRequestId).toBe("11111111-1111-1111-1111-111111111111");
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(String(url)).toBe(`https://beta.app.paiflow.xyz/api/v1/deployments/${DEP}/execute`);
    expect(JSON.parse(String(init.body))).toEqual({ amount: "10000000", from: "GABC" });
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN}`);
    expect(init.redirect).toBe("error");
  });

  it("submit forwards x-preparation-request-id and surfaces API errors", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: { code: "VALIDATION", message: "Envelope is not this flow's deposit" } }), { status: 422, headers: { "x-request-id": "r1" } }),
    );
    const a = new PaiflowAdapter("https://beta.app.paiflow.xyz", TOKEN);
    await expect(a.submit(DEP, "SIGNED", "pid", true)).rejects.toBeInstanceOf(PaiflowError);
    const [, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect((init.headers as Record<string, string>)["x-preparation-request-id"]).toBe("pid");
  });

  it("rejects non-UUID deployment ids before any request", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const a = new PaiflowAdapter("https://beta.app.paiflow.xyz", TOKEN);
    await expect(a.capabilities("../admin")).rejects.toThrow(/UUID/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("assertPaiflowDeposit", () => {
  const from = Keypair.random().publicKey();
  const prepared = (xdr: string) => ({ xdr, networkPassphrase: Networks.TESTNET, network: "testnet", expiresAt: "", preparationRequestId: null });

  it("accepts exactly one deposit(from, amount) from the user", () => {
    const { tx, triggerContract } = assertPaiflowDeposit(prepared(depositTx(from, 5_000_000n).toXDR()), { from, amountStroops: 5_000_000n, passphrase: Networks.TESTNET });
    expect(tx.source).toBe(from);
    expect(triggerContract).toBe(TRIGGER);
  });
  it("rejects a deposit to a different contract than the pinned trigger", () => {
    const other = "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";
    expect(() => assertPaiflowDeposit(prepared(depositTx(from, 5_000_000n).toXDR()), { from, amountStroops: 5_000_000n, passphrase: Networks.TESTNET, triggerContract: other })).toThrow(/different contract/);
  });
  it("rejects excessive fees and long validity", () => {
    const pricey = new TransactionBuilder(new Account(from, "1"), { fee: "200000000", networkPassphrase: Networks.TESTNET })
      .setTimeout(180).addOperation(new Contract(TRIGGER).call("deposit", new Address(from).toScVal(), nativeToScVal(5_000_000n, { type: "i128" }))).build();
    expect(() => assertPaiflowDeposit(prepared(pricey.toXDR()), { from, amountStroops: 5_000_000n, passphrase: Networks.TESTNET })).toThrow(/fee/);
    const forever = new TransactionBuilder(new Account(from, "1"), { fee: "100", networkPassphrase: Networks.TESTNET })
      .setTimeout(0).addOperation(new Contract(TRIGGER).call("deposit", new Address(from).toScVal(), nativeToScVal(5_000_000n, { type: "i128" }))).build();
    expect(() => assertPaiflowDeposit(prepared(forever.toXDR()), { from, amountStroops: 5_000_000n, passphrase: Networks.TESTNET })).toThrow(/validity/);
  });
  it("rejects wrong amount, wrong function, wrong source, wrong network, or a plain payment", () => {
    const exp = { from, amountStroops: 5_000_000n, passphrase: Networks.TESTNET };
    expect(() => assertPaiflowDeposit(prepared(depositTx(from, 6_000_000n).toXDR()), exp)).toThrow(/amount/);
    expect(() => assertPaiflowDeposit(prepared(depositTx(from, 5_000_000n, "withdraw").toXDR()), exp)).toThrow(/deposit/);
    const other = Keypair.random().publicKey();
    expect(() => assertPaiflowDeposit(prepared(depositTx(other, 5_000_000n).toXDR()), exp)).toThrow(/source/);
    expect(() => assertPaiflowDeposit({ ...prepared(depositTx(from, 5_000_000n).toXDR()), networkPassphrase: Networks.PUBLIC }, exp)).toThrow(/network/);
    const pay = new TransactionBuilder(new Account(from, "1"), { fee: "100", networkPassphrase: Networks.TESTNET })
      .setTimeout(60).addOperation(Operation.payment({ destination: other, asset: Asset.native(), amount: "1" })).build();
    expect(() => assertPaiflowDeposit(prepared(pay.toXDR()), exp)).toThrow(/contract call/);
  });
});
