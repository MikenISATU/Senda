"use client";

import { CheckCircle2, ExternalLink, XCircle } from "lucide-react";
import type { TxState } from "@/lib/client/useTx";
import { Modal } from "./Modal";
import { Notice, Spinner } from "./bits";

export function TxDialog({ state, onConfirm, onClose, onRecheck }: { state: TxState; onConfirm: () => void; onClose: () => void; onRecheck: () => void }) {
  const open = state.phase !== "idle";
  const busy = state.phase === "preparing" || state.phase === "signing" || state.phase === "submitting";
  const s = state.intent?.summary;
  const st = state.status;
  const title =
    state.phase === "done" && st?.status === "confirmed" ? "Confirmed on Stellar"
    : state.phase === "done" && st?.status === "failed" ? "Transaction failed"
    : state.phase === "done" ? "Waiting for the network"
    : state.phase === "error" ? "Could not prepare"
    : s?.title ?? "Preparing";
  return (
    <Modal open={open} onClose={onClose} title={title} dismissable={!busy}>
      <div aria-live="polite" className="space-y-4">
        {state.phase === "preparing" && <Spinner label="Building the transaction" />}

        {s && (state.phase === "review" || state.phase === "signing" || state.phase === "submitting") && (
          <>
            <dl className="divide-y divide-line rounded-xl border border-line">
              {s.lines.map((l) => (
                <div key={l.label} className="flex items-start justify-between gap-4 px-3.5 py-2.5">
                  <dt className="text-sm text-slate">{l.label}</dt>
                  <dd className="tabular text-right text-sm font-semibold break-words">{l.value}</dd>
                </div>
              ))}
              <div className="flex justify-between gap-4 px-3.5 py-2.5">
                <dt className="text-sm text-slate">Network</dt>
                <dd className="text-right text-sm font-semibold">{s.network}</dd>
              </div>
            </dl>
            <p className="text-sm text-slate">{s.feeNote}. You are signing exactly this transaction; Senda cannot change it after you approve.</p>
            {state.error && <Notice tone="warn">{state.error}</Notice>}
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button className="btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
              <button className="btn-primary" onClick={onConfirm} disabled={busy}>
                {state.phase === "signing" ? "Waiting for signature" : state.phase === "submitting" ? "Sending to Stellar" : "Approve and send"}
              </button>
            </div>
            {busy && <Spinner label={state.phase === "signing" ? "Signing with your Senda wallet" : "Waiting for the ledger to close"} />}
          </>
        )}

        {state.phase === "error" && (
          <>
            <Notice tone="danger">{state.error}</Notice>
            <div className="flex justify-end"><button className="btn-outline" onClick={onClose}>Close</button></div>
          </>
        )}

        {state.phase === "done" && (
          <>
            {st?.status === "confirmed" && (
              <p className="flex items-center gap-2 text-mint-deep"><CheckCircle2 aria-hidden /> Included in a ledger. This is final.</p>
            )}
            {st?.status === "failed" && (
              <p className="flex items-center gap-2 text-danger"><XCircle aria-hidden /> {st.error ?? "The network rejected it. No funds moved."}</p>
            )}
            {(!st || st.status === "submitted") && (
              <Notice tone="warn">Submitted but not yet confirmed. Do not send again; check the status in a moment.</Notice>
            )}
            {state.error && <Notice tone="warn">{state.error}</Notice>}
            {st?.explorerUrl && (
              <a className="link inline-flex items-center gap-1.5 text-sm" href={st.explorerUrl} target="_blank" rel="noreferrer">
                View on Stellar Expert <ExternalLink size={14} aria-hidden />
              </a>
            )}
            {st?.hash && <p className="tabular break-all text-xs text-slate">Tx {st.hash}</p>}
            <div className="flex justify-end gap-2">
              {(!st || st.status === "submitted") && <button className="btn-outline" onClick={onRecheck}>Check status</button>}
              <button className="btn-ink" onClick={onClose}>Done</button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
