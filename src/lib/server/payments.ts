import "server-only";
import type { Caller } from "./auth";
import { bad } from "./http";
import { createIntent, type PreparedIntent } from "./intents";
import { resolveRecipient } from "./recipients";
import { db } from "./supabase";
import { getBalances } from "@/lib/stellar/account";
import { formatAmount, toStroops } from "@/lib/stellar/amount";
import { asset } from "@/lib/stellar/network";
import { buildPaymentTx } from "@/lib/stellar/tx";

/**
 * Builds a person-to-person payment intent (SEND or REQUEST). Used by the
 * wallet's Send form and by "Pay" on a chat payment request. Paiflow flows
 * have fixed recipients, so these are plain Stellar payments signed by the payer.
 */
export async function preparePayment(
  c: Caller,
  from: string,
  b: {
    to: string;
    asset: "XLM" | "USDC";
    amount: string;
    memo?: string;
    idempotencyKey?: string;
    payload?: Record<string, unknown>;
    title?: string;
    workflowKey?: "SEND" | "REQUEST";
  },
): Promise<PreparedIntent> {
  const stroops = toStroops(b.amount);
  if (stroops <= 0n) throw bad("Amount must be greater than zero.");
  const r = await resolveRecipient(b.to);
  if (r.address === from) throw bad("You cannot send to yourself.");

  const dest = await getBalances(r.address);
  let createIfMissing = false;
  if (!dest.exists) {
    if (b.asset !== "XLM") throw bad("The recipient's account is not activated yet. Send at least 1 XLM first.");
    if (stroops < 10_000_000n) throw bad("To activate a new account, send at least 1 XLM.");
    createIfMissing = true;
  } else if (b.asset === "USDC" && dest.usdc === null) {
    throw bad("The recipient hasn't enabled USDC yet (no trustline). Ask them to open their Senda wallet once.");
  }

  const tx = await buildPaymentTx(from, [{ destination: r.address, asset: asset(b.asset), stroops, createIfMissing }], b.memo);
  const run = await db().from("workflow_runs").insert({ workflow_key: b.workflowKey ?? "SEND", provider: "stellar", status: "prepared" }).select("id").single();
  const intent = await createIntent({
    caller: c,
    kind: "payment",
    provider: "stellar",
    tx,
    idempotencyKey: b.idempotencyKey,
    payload: { ...(b.payload ?? {}), to: r.address, recipientProfileId: r.profileId, asset: b.asset, amount: b.amount, workflowRunId: run.data?.id },
    summary: {
      title: b.title ?? `Send ${formatAmount(stroops, 7)} ${b.asset}`,
      lines: [
        { label: "To", value: r.username ? `@${r.username}` : `${r.address.slice(0, 6)}...${r.address.slice(-6)}` },
        { label: "Amount", value: `${formatAmount(stroops, 7)} ${b.asset}` },
        ...(createIfMissing ? [{ label: "Note", value: "This activates the recipient's new account" }] : []),
        ...(b.memo ? [{ label: "Memo", value: b.memo }] : []),
      ],
    },
  });
  if (run.data?.id) await db().from("workflow_runs").update({ intent_id: intent.intentId }).eq("id", run.data.id);
  return intent;
}
