import "server-only";
import type { Caller } from "./auth";
import { bad } from "./http";
import { buildPay, feeLines } from "./fees";
import { createIntent, type PreparedIntent } from "./intents";
import { resolveRecipient } from "./recipients";
import { db } from "./supabase";
import { formatAmount, toStroops } from "@/lib/stellar/amount";

/**
 * Builds a person-to-person payment (wallet Send, or Pay on a chat request).
 * The recipient's share and Senda's send fee are paid in one transaction by
 * the fee splitter contract; see lib/server/fees.ts.
 */
export async function preparePayment(
  c: Caller,
  from: string,
  b: { to: string; asset: "XLM" | "USDC"; amount: string; memo?: string; idempotencyKey?: string; payload?: Record<string, unknown>; title?: string; workflowKey?: "SEND" | "REQUEST" },
): Promise<PreparedIntent> {
  const gross = toStroops(b.amount);
  if (gross <= 0n) throw bad("Amount must be greater than zero.");
  const r = await resolveRecipient(b.to);
  if (r.address === from) throw bad("You cannot send to yourself.");

  const p = await buildPay({ from, to: r.address, code: b.asset, gross, kind: "send", memo: b.memo, allowCreate: true });
  const run = await db().from("workflow_runs").insert({ workflow_key: b.workflowKey ?? "SEND", provider: p.provider, status: "prepared" }).select("id").single();
  const toLabel = r.username ? `@${r.username}` : `${r.address.slice(0, 6)}...${r.address.slice(-6)}`;
  const intent = await createIntent({
    caller: c,
    kind: "payment",
    provider: p.provider,
    tx: p.tx,
    idempotencyKey: b.idempotencyKey,
    payload: {
      ...(b.payload ?? {}),
      to: r.address,
      recipientProfileId: r.profileId,
      asset: b.asset,
      amount: formatAmount(p.net, 7),
      gross: formatAmount(gross, 7),
      fee: formatAmount(p.fee, 7),
      workflowRunId: run.data?.id,
    },
    summary: {
      title: b.title ?? `Send ${formatAmount(gross, 7)} ${b.asset}`,
      lines: [
        { label: "To", value: toLabel },
        { label: "Amount", value: `${formatAmount(gross, 7)} ${b.asset}` },
        ...feeLines(toLabel, p, b.asset),
        ...(p.createIfMissing ? [{ label: "Note", value: "This sets up the recipient's new wallet" }] : []),
        ...(b.memo ? [{ label: "Note", value: b.memo }] : []),
      ],
    },
  });
  if (run.data?.id) await db().from("workflow_runs").update({ intent_id: intent.intentId }).eq("id", run.data.id);
  return intent;
}
