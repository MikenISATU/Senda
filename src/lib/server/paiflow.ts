import "server-only";
import { Address, Operation, Transaction, TransactionBuilder, scValToNative } from "@stellar/stellar-sdk";
import { env } from "./env";

/**
 * Server-side adapter for Paiflow's documented /api/v1 (OpenAPI 1.1.0, SDK 0.2.0).
 * Only documented endpoints are used:
 *   GET  /api/v1/deployments/{id}/capabilities
 *   POST /api/v1/deployments/{id}/execute            (prepare unsigned deposit)
 *   POST /api/v1/deployments/{id}/execute/submit     (submit wallet-signed deposit)
 *   GET  /api/v1/deployments/{id}/transactions/{hash} (status lookup)
 *   GET  /api/v1/deployments/{id}/events             (decoded events, cursor paging)
 * Paiflow does not push signed webhooks to integrators; events are pulled with
 * the bearer token over TLS, deduplicated by eventId, and cross-checked against
 * the transaction status endpoint before Senda acts on them.
 */

/** Senda uses two Paiflow flows, both "On Receive > Split" fee splits. */
export type WorkflowKey = "FEES_USDC" | "FEES_XLM";
export const WORKFLOW_KEYS: WorkflowKey[] = ["FEES_USDC", "FEES_XLM"];

export class PaiflowError extends Error {
  constructor(public status: number, public code: string, message: string, public requestId?: string | null, public retryAfter?: string | null) {
    super(message);
  }
}

export type Prepared = { xdr: string; networkPassphrase: string; network: string; expiresAt: string; preparationRequestId: string | null };
export type TxStatus = { txHash: string; status: "SUCCESS" | "PENDING" | "FAILED" | "REJECTED" | "UNKNOWN"; ledger?: number; error?: { code: string; message: string } };
export type PaiflowEvent = { id: string; eventId: string; kind: string; topic: string; ledger: number; txHash: string; occurredAt: string; data: Record<string, unknown> };
export type Capabilities = {
  deploymentId: string;
  network: string;
  triggerType: string;
  inputAsset: unknown;
  operations: Record<string, { status: "supported" | "conditional" | "unsupported"; authentication?: string; requirements?: unknown; nodeIds?: string[] }>;
};

const UUID_RE = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const TOKEN_RE = /^(?:pfk|pfd)_[a-f0-9]{64}$/;
const HASH_RE = /^[0-9a-f]{64}$/i;

export class PaiflowAdapter {
  private origin: URL;
  constructor(baseUrl: string, private token: string) {
    const u = new URL(baseUrl);
    if (u.protocol !== "https:" || (u.pathname !== "/" && u.pathname !== "") || u.username || u.password || u.search || u.hash) {
      throw new Error("PAIFLOW_API_BASE_URL must be a bare https origin");
    }
    if (!TOKEN_RE.test(token)) throw new Error("PAIFLOW_API_KEY must be a pfd_ or pfk_ token");
    this.origin = u;
  }

  private async call<T>(deploymentId: string, path: string, init: RequestInit & { preparationRequestId?: string | null } = {}): Promise<{ data: T; headers: Headers }> {
    if (!UUID_RE.test(deploymentId)) throw new PaiflowError(422, "CONFIG", "Workflow id must be a Paiflow deployment UUID");
    const res = await fetch(new URL(`/api/v1/deployments/${deploymentId}/${path}`, this.origin), {
      ...init,
      redirect: "error",
      cache: "no-store",
      credentials: "omit",
      signal: AbortSignal.timeout(35_000),
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
        ...(init.preparationRequestId ? { "x-preparation-request-id": init.preparationRequestId } : {}),
      },
    });
    const json = (await res.json().catch(() => null)) as { data?: T; error?: { code: string; message: string } } | null;
    if (!res.ok || !json || json.error || json.data === undefined) {
      throw new PaiflowError(res.status, json?.error?.code ?? "HTTP_ERROR", json?.error?.message ?? `Paiflow HTTP ${res.status}`, res.headers.get("x-request-id"), res.headers.get("retry-after"));
    }
    return { data: json.data, headers: res.headers };
  }

  capabilities(deploymentId: string) {
    return this.call<Capabilities>(deploymentId, "capabilities").then((r) => r.data);
  }

  /** Builds + simulates an unsigned deposit. amount is integer stroops of the flow's input asset. */
  async prepare(deploymentId: string, input: { amountStroops: bigint; from: string }): Promise<Prepared> {
    if (input.amountStroops <= 0n) throw new PaiflowError(422, "VALIDATION", "Amount must be positive");
    const r = await this.call<Omit<Prepared, "preparationRequestId">>(deploymentId, "execute", {
      method: "POST",
      body: JSON.stringify({ amount: input.amountStroops.toString(), from: input.from }),
    });
    return { ...r.data, preparationRequestId: r.headers.get("x-history-request-id") };
  }

  /** Submits the exact signed envelope. Idempotent on envelope hash (Paiflow guarantee). */
  async submit(deploymentId: string, signedXdr: string, preparationRequestId: string | null, wait = true): Promise<TxStatus> {
    const r = await this.call<TxStatus>(deploymentId, `execute/submit${wait ? "" : "?wait=false"}`, {
      method: "POST",
      body: JSON.stringify({ signedXdr }),
      preparationRequestId,
    });
    return r.data;
  }

  async lookupStatus(deploymentId: string, txHash: string): Promise<TxStatus> {
    if (!HASH_RE.test(txHash)) throw new PaiflowError(422, "VALIDATION", "Invalid hash");
    return (await this.call<TxStatus>(deploymentId, `transactions/${txHash}`)).data;
  }

  async events(deploymentId: string, q: { cursor?: string; txHash?: string; limit?: number } = {}) {
    const p = new URLSearchParams();
    p.set("limit", String(Math.min(q.limit ?? 50, 100)));
    if (q.cursor) p.set("cursor", q.cursor);
    if (q.txHash) p.set("txHash", q.txHash);
    return (await this.call<{ items: PaiflowEvent[]; nextCursor: string | null; hasMore: boolean }>(deploymentId, `events?${p}`)).data;
  }
}

export function paiflow(): PaiflowAdapter | null {
  const e = env();
  if (!e.PAIFLOW_API_KEY) return null;
  return new PaiflowAdapter(e.PAIFLOW_API_BASE_URL, e.PAIFLOW_API_KEY);
}

export function workflowId(key: WorkflowKey): string | undefined {
  const e = env();
  // Older five-flow variable names are still read as fallbacks.
  return {
    FEES_USDC: e.PAIFLOW_FEES_USDC_WORKFLOW_ID ?? e.PAIFLOW_TIP_WORKFLOW_ID,
    FEES_XLM: e.PAIFLOW_FEES_XLM_WORKFLOW_ID ?? e.PAIFLOW_RECEIVE_WORKFLOW_ID,
  }[key];
}

/** Max total fee (XLM stroops) we let a user sign on a Paiflow deposit. Testnet resource fees can be large. */
export const PAIFLOW_MAX_FEE_STROOPS = 100_000_000n; // 10 XLM

type AuthInvocation = {
  function: { type: string; contractFn?: { contractAddress: unknown; functionName: { toString(): string }; args: unknown[] } };
  subInvocations: AuthInvocation[];
};

/**
 * Before asking a user to sign a Paiflow-prepared envelope, prove it is exactly
 * one `deposit(from, amount)` call on the expected trigger contract, from the
 * expected account, on the expected network, with a bounded fee and short
 * validity, and that its authorization tree only allows that deposit plus token
 * transfers of exactly `amount` from the user. Paiflow checks this too; we check
 * independently so a compromised upstream cannot get anything else signed.
 */
export function assertPaiflowDeposit(
  prepared: Prepared,
  expected: { from: string; amountStroops: bigint; passphrase: string; triggerContract?: string | null },
): { tx: Transaction; triggerContract: string } {
  const fail = (m: string): never => {
    throw new PaiflowError(422, "UNEXPECTED_ENVELOPE", m);
  };
  if (prepared.networkPassphrase !== expected.passphrase) throw new PaiflowError(422, "NETWORK_MISMATCH", "Paiflow prepared a transaction for a different network");
  const tx = TransactionBuilder.fromXDR(prepared.xdr, expected.passphrase);
  if (!(tx instanceof Transaction)) return fail("Fee-bump envelopes are not accepted");
  if (tx.source !== expected.from) fail("Envelope source is not the user's wallet");
  if (BigInt(tx.fee) > PAIFLOW_MAX_FEE_STROOPS) fail("Network fee is unexpectedly high");
  const maxTime = Number(tx.timeBounds?.maxTime ?? 0);
  if (!maxTime || maxTime > Date.now() / 1000 + 600) fail("Envelope validity window is too long");
  if (tx.operations.length !== 1) fail("Envelope must contain exactly one operation");
  const op = tx.operations[0] as Operation.InvokeHostFunction;
  if (op.type !== "invokeHostFunction") fail("Envelope is not a contract call");
  const fn = op.func;
  if (fn.type !== "hostFunctionTypeInvokeContract") fail("Unexpected host function");
  const ic = (fn as unknown as { invokeContract: { contractAddress: unknown; functionName: { toString(): string }; args: unknown[] } }).invokeContract;
  const contract = scAddressToString(ic.contractAddress);
  if (expected.triggerContract && contract !== expected.triggerContract) fail("Envelope calls a different contract than this deployment's trigger");
  if (ic.functionName.toString() !== "deposit") fail("Envelope must call deposit");
  const args = ic.args as Parameters<typeof Address.fromScVal>[0][];
  if (args.length !== 2) fail("Unexpected deposit arguments");
  const from = Address.fromScVal(args[0]).toString();
  const amount = BigInt(scValToNative(args[1] as never) as bigint | number);
  if (from !== expected.from || amount !== expected.amountStroops) fail("Deposit sender or amount differs from the request");

  // Authorization tree: root must be this same deposit; children may only be
  // token transfers from the user of exactly `amount`.
  const auth = ((op as unknown as { auth?: { rootInvocation: AuthInvocation }[] }).auth ?? []);
  for (const entry of auth) {
    const root = entry.rootInvocation;
    const rf = root.function.contractFn;
    if (root.function.type !== "sorobanAuthorizedFunctionTypeContractFn" || !rf) fail("Unexpected authorization entry");
    if (scAddressToString(rf!.contractAddress) !== contract || rf!.functionName.toString() !== "deposit") fail("Authorization is for a different call");
    const walk = (inv: AuthInvocation) => {
      for (const sub of inv.subInvocations) {
        const f = sub.function.contractFn;
        if (sub.function.type !== "sorobanAuthorizedFunctionTypeContractFn" || !f || f.functionName.toString() !== "transfer") fail("Authorization allows more than a token transfer");
        const a = f!.args as Parameters<typeof Address.fromScVal>[0][];
        if (a.length !== 3) fail("Unexpected transfer authorization");
        const tFrom = Address.fromScVal(a[0]).toString();
        const tAmount = BigInt(scValToNative(a[2] as never) as bigint | number);
        if (tFrom !== expected.from || tAmount !== expected.amountStroops) fail("Authorized transfer differs from the deposit");
        walk(sub);
      }
    };
    walk(root);
  }
  return { tx, triggerContract: contract };
}

function scAddressToString(a: unknown): string {
  try {
    return Address.fromScAddress(a as Parameters<typeof Address.fromScAddress>[0]).toString();
  } catch {
    return "";
  }
}
