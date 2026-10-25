import "server-only";
import {
  Account,
  Address,
  Contract,
  Keypair,
  Memo,
  Operation,
  Transaction,
  TransactionBuilder,
  rpc,
  xdr,
  type Asset,
} from "@stellar/stellar-sdk";
import { toSdkAmount } from "./amount";
import { horizon, network, sorobanRpc } from "./network";

/** 0.0001 XLM per op; generous enough for testnet congestion, tiny in value. */
const CLASSIC_FEE = "1000";
export const TX_TIMEOUT_SECONDS = 180;

export class TxBuildError extends Error {
  constructor(message: string, public code = "TX_BUILD") {
    super(message);
  }
}

export type PaymentLeg = { destination: string; asset: Asset; stroops: bigint; createIfMissing?: boolean };

async function sourceAccount(address: string): Promise<Account> {
  try {
    const a = await horizon().loadAccount(address);
    return new Account(a.accountId(), a.sequenceNumber());
  } catch {
    throw new TxBuildError("Your wallet is not activated on the network yet. Claim testnet XLM first.", "SOURCE_MISSING");
  }
}

/** One atomic transaction with one or more payment legs (e.g. creator + platform fee). */
export async function buildPaymentTx(source: string, legs: PaymentLeg[], memo?: string): Promise<Transaction> {
  if (!legs.length || legs.length > 5) throw new TxBuildError("Invalid payment.");
  const n = network();
  const acct = await sourceAccount(source);
  const b = new TransactionBuilder(acct, { fee: CLASSIC_FEE, networkPassphrase: n.passphrase }).setTimeout(TX_TIMEOUT_SECONDS);
  for (const leg of legs) {
    if (leg.destination === source) throw new TxBuildError("You cannot pay yourself.");
    if (leg.stroops <= 0n) continue;
    if (leg.createIfMissing && leg.asset.isNative()) {
      b.addOperation(Operation.createAccount({ destination: leg.destination, startingBalance: toSdkAmount(leg.stroops) }));
    } else {
      b.addOperation(Operation.payment({ destination: leg.destination, asset: leg.asset, amount: toSdkAmount(leg.stroops) }));
    }
  }
  if (memo) b.addMemo(Memo.text(memo.slice(0, 28)));
  return b.build();
}

export async function buildChangeTrustTx(source: string, asset: Asset): Promise<Transaction> {
  const acct = await sourceAccount(source);
  return new TransactionBuilder(acct, { fee: CLASSIC_FEE, networkPassphrase: network().passphrase })
    .setTimeout(TX_TIMEOUT_SECONDS)
    .addOperation(Operation.changeTrust({ asset }))
    .build();
}

/**
 * Builds and simulates a Soroban contract call. Simulation fills the footprint,
 * resource fee and auth entries. When the authorizing address equals the tx
 * source, Soroban uses source-account credentials, so one envelope signature
 * (from the user's Privy wallet) authorizes everything.
 */
export async function buildContractCallTx(source: string, contractId: string, method: string, args: xdr.ScVal[]): Promise<Transaction> {
  const server = sorobanRpc();
  const acct = await sourceAccount(source);
  const tx = new TransactionBuilder(acct, { fee: "100000", networkPassphrase: network().passphrase })
    .setTimeout(TX_TIMEOUT_SECONDS)
    .addOperation(new Contract(contractId).call(method, ...args))
    .build();
  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) {
    throw new TxBuildError(explainSimulationError(sim.error), "SIMULATION_FAILED");
  }
  return rpc.assembleTransaction(tx, sim).build();
}

/** Read-only contract call (simulation only, nothing is submitted). */
export async function simulateRead(contractId: string, method: string, args: xdr.ScVal[], readerAddress?: string): Promise<xdr.ScVal | null> {
  const server = sorobanRpc();
  // Any existing account works as the simulated source; it is never signed.
  const reader = readerAddress ?? Keypair.random().publicKey();
  const acct = readerAddress ? await sourceAccount(reader) : new Account(reader, "0");
  const tx = new TransactionBuilder(acct, { fee: "100", networkPassphrase: network().passphrase })
    .setTimeout(30)
    .addOperation(new Contract(contractId).call(method, ...args))
    .build();
  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) throw new TxBuildError(explainSimulationError(sim.error), "SIMULATION_FAILED");
  return sim.result?.retval ?? null;
}

const ESCROW_ERRORS: Record<number, string> = {
  1: "Escrow is paused for new funding.", 2: "This asset is not allowed in escrow.", 3: "Invalid amount.",
  4: "This job is already funded.", 5: "Escrow job not found on-chain.", 6: "That action is not allowed in the current job state.",
  7: "Only the client or freelancer can do that.", 8: "Deadline must be in the future.", 9: "The deadline has not passed yet.",
  10: "The client review window is still open.", 11: "Maximum revisions reached. Approve or open a dispute.",
  13: "Client and freelancer must be different.", 17: "The dispute is not stale yet.", 18: "No matching settlement proposal.",
};

export function explainSimulationError(err: string): string {
  const m = err.match(/Error\(Contract, #(\d+)\)/);
  if (m && ESCROW_ERRORS[Number(m[1])]) return ESCROW_ERRORS[Number(m[1])];
  if (/trustline/i.test(err)) return "A USDC trustline is missing on one of the accounts.";
  if (/balance|insufficient/i.test(err)) return "Insufficient balance for this transaction (amount plus network fee).";
  return "The network rejected this transaction during simulation.";
}

/** Converts a Privy raw-hash signature (0x-hex ed25519) and attaches it after verifying. */
export function attachSignature(unsignedXdr: string, signer: string, signatureHex: string): Transaction {
  const tx = TransactionBuilder.fromXDR(unsignedXdr, network().passphrase);
  if (!(tx instanceof Transaction)) throw new TxBuildError("Unexpected fee-bump envelope.");
  if (!/^0x[0-9a-fA-F]{128}$/.test(signatureHex)) throw new TxBuildError("Malformed signature.", "BAD_SIGNATURE");
  const sig = Buffer.from(signatureHex.slice(2), "hex");
  if (!Keypair.fromPublicKey(signer).verify(tx.hash(), sig)) throw new TxBuildError("Signature does not match this transaction.", "BAD_SIGNATURE");
  tx.addSignature(signer, sig.toString("base64"));
  return tx;
}

export type SubmitResult =
  | { status: "confirmed"; hash: string; ledger?: number; returnValue?: unknown }
  | { status: "pending"; hash: string }
  | { status: "failed"; hash: string; error: string };

function horizonError(e: unknown): string {
  const extras = (e as { response?: { data?: { extras?: { result_codes?: { transaction?: string; operations?: string[] } } } } })?.response?.data?.extras;
  const codes = extras?.result_codes;
  if (!codes) return (e as Error)?.message ?? "Submission failed";
  const ops = codes.operations?.join(", ");
  const map: Record<string, string> = {
    op_underfunded: "Insufficient balance.",
    op_no_trust: "The recipient has no USDC trustline yet.",
    op_no_destination: "Recipient account does not exist. Send at least 1 XLM to activate it.",
    op_low_reserve: "Not enough XLM left for the account reserve.",
    op_line_full: "Recipient cannot hold more of this asset.",
    tx_bad_seq: "Your wallet sequence changed. Please try again.",
    tx_too_late: "This transaction expired before submission. Prepare it again.",
    tx_insufficient_fee: "Network fee too low. Please retry.",
  };
  const first = codes.operations?.find((c) => c !== "op_success") ?? codes.transaction ?? "";
  return map[first] ?? `Rejected by network (${codes.transaction}${ops ? `: ${ops}` : ""}).`;
}

export async function submitClassic(tx: Transaction): Promise<SubmitResult> {
  const hash = Buffer.from(tx.hash()).toString("hex");
  try {
    const r = await horizon().submitTransaction(tx);
    return r.successful ? { status: "confirmed", hash, ledger: r.ledger } : { status: "failed", hash, error: "Transaction failed." };
  } catch (e) {
    const status = (e as { response?: { status?: number } })?.response?.status;
    // 504 = Horizon timed out waiting; the tx may still land. Keep it pending and reconcile.
    if (status === 504 || status === undefined) return { status: "pending", hash };
    return { status: "failed", hash, error: horizonError(e) };
  }
}

export async function submitSoroban(tx: Transaction, waitMs = 20_000): Promise<SubmitResult> {
  const server = sorobanRpc();
  const hash = Buffer.from(tx.hash()).toString("hex");
  const sent = await server.sendTransaction(tx);
  if (sent.status === "ERROR") return { status: "failed", hash, error: "Rejected by the network." };
  if (sent.status === "TRY_AGAIN_LATER") return { status: "failed", hash, error: "Network busy. Please retry." };
  return pollSoroban(hash, waitMs);
}

export async function pollSoroban(hash: string, waitMs = 20_000): Promise<SubmitResult> {
  const server = sorobanRpc();
  const until = Date.now() + waitMs;
  while (Date.now() < until) {
    const r = await server.getTransaction(hash);
    if (r.status === rpc.Api.GetTransactionStatus.SUCCESS) {
      return { status: "confirmed", hash, ledger: r.ledger, returnValue: r.returnValue };
    }
    if (r.status === rpc.Api.GetTransactionStatus.FAILED) return { status: "failed", hash, error: "Contract call failed on-chain." };
    await new Promise((res) => setTimeout(res, 1500));
  }
  return { status: "pending", hash };
}

/** Authoritative lookup of a classic transaction by hash. */
export async function lookupClassic(hash: string): Promise<SubmitResult> {
  try {
    const t = await horizon().transactions().transaction(hash).call();
    return t.successful ? { status: "confirmed", hash, ledger: t.ledger_attr } : { status: "failed", hash, error: "Transaction failed." };
  } catch (e) {
    if ((e as { response?: { status?: number } })?.response?.status === 404) return { status: "pending", hash };
    throw e;
  }
}

export function scAddress(a: string) {
  return new Address(a).toScVal();
}
