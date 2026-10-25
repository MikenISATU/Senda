import "server-only";
import { Transaction, TransactionBuilder } from "@stellar/stellar-sdk";
import { horizon, network } from "@/lib/stellar/network";
import { attachSignature, lookupClassic, pollSoroban, submitClassic, submitSoroban, type SubmitResult } from "@/lib/stellar/tx";
import type { Caller } from "./auth";
import { conflict, forbidden, HttpError, notFound } from "./http";
import { paiflow, PaiflowError } from "./paiflow";
import { db, must } from "./supabase";
import { onConfirmed, onFailed } from "./effects";

export type IntentKind =
  | "payment" | "tip" | "purchase" | "trustline" | "escrow_fund" | "escrow_action" | "earn_supply" | "earn_withdraw" | "paiflow_deposit";
export type Provider = "stellar" | "soroban" | "paiflow";

export type Summary = {
  title: string;
  lines: { label: string; value: string }[];
  network: string;
  feeNote: string;
};

export type IntentRow = {
  id: string;
  profile_id: string;
  kind: IntentKind;
  provider: Provider;
  network: string;
  source_address: string;
  tx_hash: string;
  xdr: string;
  payload: Record<string, unknown>;
  summary: Summary;
  status: "prepared" | "submitted" | "confirmed" | "failed" | "expired";
  result: Record<string, unknown> | null;
  error: string | null;
  expires_at: string;
};

export type PreparedIntent = { intentId: string; hash: string; expiresAt: string; summary: Summary; signer: string };

/** Persists the exact transaction to be signed. The client only ever receives the hash. */
export async function createIntent(args: {
  caller: Caller;
  kind: IntentKind;
  provider: Provider;
  tx: Transaction;
  payload: Record<string, unknown>;
  summary: Omit<Summary, "network" | "feeNote"> & { feeNote?: string };
  idempotencyKey?: string;
}): Promise<PreparedIntent> {
  const n = network();
  const source = args.tx.source;
  if (source !== args.caller.wallet) throw forbidden("Transaction source is not your wallet");
  const hash = Buffer.from(args.tx.hash()).toString("hex");
  const maxTime = Number(args.tx.timeBounds?.maxTime ?? 0);
  const expiresAt = new Date((maxTime > 0 ? maxTime : Date.now() / 1000 + 170) * 1000 - 10_000).toISOString();
  const summary: Summary = {
    ...args.summary,
    network: n.isTestnet ? "Stellar Testnet (test assets, no real value)" : "Stellar Mainnet",
    feeNote: args.summary.feeNote ?? `Network fee up to ${(Number(args.tx.fee) / 1e7).toFixed(5)} XLM`,
  };
  const row = must(
    await db()
      .from("tx_intents")
      .insert({
        profile_id: args.caller.profile.id,
        kind: args.kind,
        provider: args.provider,
        network: n.name,
        source_address: source,
        tx_hash: hash,
        xdr: args.tx.toXDR(),
        payload: args.payload,
        summary,
        idempotency_key: args.idempotencyKey ?? null,
        expires_at: expiresAt,
      })
      .select("id")
      .single(),
  ) as { id: string };
  return { intentId: row.id, hash, expiresAt, summary, signer: source };
}

export async function loadIntent(id: string, profileId: string): Promise<IntentRow> {
  const r = must(await db().from("tx_intents").select("*").eq("id", id).maybeSingle()) as IntentRow | null;
  if (!r) throw notFound("Transaction not found");
  if (r.profile_id !== profileId) throw forbidden();
  return r;
}

/**
 * Attaches the wallet's signature (verified against the stored hash) and
 * submits. Exactly-once: the prepared -> submitted transition is a guarded
 * UPDATE, so concurrent or repeated calls cannot submit twice.
 */
export async function submitIntent(caller: Caller, intentId: string, signatureHex: string) {
  const intent = await loadIntent(intentId, caller.profile.id);
  if (intent.status !== "prepared") return publicIntent(intent);
  if (new Date(intent.expires_at).getTime() < Date.now()) {
    await db().from("tx_intents").update({ status: "expired" }).eq("id", intent.id).eq("status", "prepared");
    await db().from("workflow_runs").update({ status: "expired" }).eq("intent_id", intent.id);
    throw new HttpError(410, "This transaction expired before it was signed. Nothing was sent. Please try again.", "EXPIRED");
  }
  const signed = attachSignature(intent.xdr, intent.source_address, signatureHex);
  if (Buffer.from(signed.hash()).toString("hex") !== intent.tx_hash) throw conflict("Transaction changed");

  const claimed = must(
    await db()
      .from("tx_intents")
      .update({ status: "submitted", submitted_at: new Date().toISOString() })
      .eq("id", intent.id)
      .eq("status", "prepared")
      .select("id"),
  ) as { id: string }[];
  if (!claimed.length) return publicIntent(await loadIntent(intentId, caller.profile.id));
  await db().from("workflow_runs").update({ status: "submitted", tx_hash: intent.tx_hash }).eq("intent_id", intent.id);

  let result: SubmitResult;
  try {
    if (intent.provider === "paiflow") {
      const pf = paiflow();
      const deploymentId = intent.payload.deploymentId as string;
      if (!pf || !deploymentId) throw new HttpError(503, "Paiflow is not configured", "NOT_CONFIGURED");
      const s = await pf.submit(deploymentId, signed.toXDR(), (intent.payload.preparationRequestId as string) ?? null, true);
      result =
        s.status === "SUCCESS" ? { status: "confirmed", hash: s.txHash, ledger: s.ledger }
        : s.status === "FAILED" ? { status: "failed", hash: s.txHash, error: s.error?.message ?? "Failed on-chain" }
        : { status: "pending", hash: s.txHash };
    } else if (intent.provider === "soroban") {
      result = await submitSoroban(signed);
    } else {
      result = await submitClassic(signed);
    }
  } catch (e) {
    // Transport failures do not prove the tx was not broadcast: stay "submitted"
    // and let the reconciler resolve the original hash. Never re-sign.
    const msg = e instanceof PaiflowError ? e.message : "Network unavailable";
    await db().from("tx_intents").update({ result: { transportError: msg } }).eq("id", intent.id);
    return publicIntent({ ...intent, status: "submitted" });
  }
  return applyResult({ ...intent, status: "submitted" }, result);
}

export async function applyResult(intent: IntentRow, result: SubmitResult) {
  if (result.status === "confirmed") {
    // Exactly-once side effects: only the caller that claims the intent runs them.
    // (Submit polling, status checks and the reconciler can all race here.)
    const claimed = must(
      await db().from("tx_intents").update({ effects_applied_at: new Date().toISOString() }).eq("id", intent.id).is("effects_applied_at", null).select("id"),
    ) as { id: string }[];
    if (claimed.length) {
      try {
        await onConfirmed(intent, result);
      } catch (e) {
        await db().from("tx_intents").update({ effects_applied_at: null }).eq("id", intent.id);
        throw e;
      }
    }
    await db()
      .from("tx_intents")
      .update({ status: "confirmed", confirmed_at: new Date().toISOString(), result: { ledger: result.ledger ?? null } })
      .eq("id", intent.id)
      .in("status", ["submitted", "prepared", "failed"]);
    return publicIntent({ ...intent, status: "confirmed", result: { ledger: result.ledger ?? null } });
  }
  if (result.status === "failed") {
    await db().from("tx_intents").update({ status: "failed", error: result.error }).eq("id", intent.id).in("status", ["submitted", "prepared"]);
    await onFailed(intent);
    return publicIntent({ ...intent, status: "failed", error: result.error });
  }
  return publicIntent(intent);
}

/** Re-checks a submitted intent against the network (used by status polling and the reconciler). */
export async function refreshIntent(intent: IntentRow) {
  if (intent.status !== "submitted") return publicIntent(intent);
  let r: SubmitResult;
  if (intent.provider === "paiflow") {
    const pf = paiflow();
    if (!pf) return publicIntent(intent);
    const s = await pf.lookupStatus(intent.payload.deploymentId as string, intent.tx_hash);
    r = s.status === "SUCCESS" ? { status: "confirmed", hash: s.txHash, ledger: s.ledger }
      : s.status === "FAILED" ? { status: "failed", hash: s.txHash, error: s.error?.message ?? "Failed" }
      : { status: "pending", hash: s.txHash };
  } else if (intent.provider === "soroban") {
    r = await pollSoroban(intent.tx_hash, 1);
  } else {
    r = await lookupClassic(intent.tx_hash);
  }
  // A transaction can never be included after its max time. Mark it failed only
  // once the network has provably moved past that time:
  //  - classic: Horizon's latest ingested ledger closed after max time (+30s), so
  //    indexer lag can't make a landed payment look missing;
  //  - Soroban: RPC reports NOT_FOUND well after max time but inside its history
  //    window (we only decide within 6h; older cases stay pending for review).
  if (r.status === "pending" && intent.provider !== "paiflow") {
    const tx = TransactionBuilder.fromXDR(intent.xdr, network().passphrase) as Transaction;
    const maxTime = Number(tx.timeBounds?.maxTime ?? 0);
    const now = Date.now() / 1000;
    if (maxTime && intent.provider === "stellar") {
      const latest = await horizon().ledgers().order("desc").limit(1).call().catch(() => null);
      const closedAt = latest?.records?.[0] ? Date.parse(latest.records[0].closed_at) / 1000 : 0;
      if (closedAt > maxTime + 30) r = { status: "failed", hash: intent.tx_hash, error: "Expired without being included in a ledger." };
    } else if (maxTime && intent.provider === "soroban" && now > maxTime + 120 && now < maxTime + 6 * 3600) {
      r = { status: "failed", hash: intent.tx_hash, error: "Expired without being included in a ledger." };
    }
  }
  return applyResult(intent, r);
}

export function publicIntent(i: Pick<IntentRow, "id" | "kind" | "status" | "tx_hash" | "error" | "summary"> & { result?: Record<string, unknown> | null }) {
  return {
    intentId: i.id,
    kind: i.kind,
    status: i.status,
    hash: i.tx_hash,
    error: i.error ?? null,
    explorerUrl: i.status === "confirmed" || i.status === "submitted" || i.status === "failed" ? `${network().explorer}/tx/${i.tx_hash}` : null,
    summary: i.summary,
  };
}
