"use client";

import { CheckCircle2, ExternalLink, XCircle } from "lucide-react";
import type { TxState } from "@/lib/client/useTx";
import { friendlyError } from "@/lib/client/errors";
import { ErrorNote } from "./ErrorNote";
import { Modal } from "./Modal";
import { Notice, Spinner } from "./bits";

export function TxDialog({ state, onConfirm, onClose, onRecheck }: { state: TxState; onConfirm: () => void; onClose: () => void; onRecheck: () => void }) {
  const open = state.phase !== "idle";
  const busy = state.phase === "preparing" || state.phase === "signing" || state.phase === "submitting";
  const s = state.intent?.summary;
  const st = state.status;
  const title =
    state.phase === "done" && st?.status === "confirmed" ? "Done"
    : state.phase === "done" && st?.status === "failed" ? "It didn't go through"
    : state.phase === "done" ? "Almost there"
    : state.phase === "error" ? (state.problem?.title ?? "This can't be done right now")
    : s?.title ?? "Preparing";
  return (
    <Modal open={open} onClose={onClose} title={title} dismissable={!busy}>
      <div aria-live="polite" className="space-y-4">
        {state.phase === "preparing" && <Spinner label="Getting it ready" />}

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
                <dt className="text-sm text-slate">Mode</dt>
                <dd className="text-right text-sm font-semibold">{s.network}</dd>
              </div>
            </dl>
            <p className="text-sm text-slate">{s.feeNote}. You are signing exactly this transaction; Senda cannot change it after you approve.</p>
            {state.error && <ErrorNote compact error={state.problem ?? state.error} />}
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button className="btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
              <button className="btn-primary" onClick={onConfirm} disabled={busy}>
                {state.phase === "signing" ? "Confirming" : state.phase === "submitting" ? "Sending" : "Confirm"}
              </button>
            </div>
            {busy && <Spinner label={state.phase === "signing" ? "Confirming with your wallet" : "Sending, a few seconds"} />}
          </>
        )}

        {state.phase === "error" && (
          <>
            <ErrorNote error={state.problem ?? state.error} />
            <div className="flex justify-end"><button className="btn-outline w-full sm:w-auto" onClick={onClose}>Close</button></div>
          </>
        )}

        {state.phase === "done" && (
          <>
            {st?.status === "confirmed" && (
              <p className="flex items-center gap-2 text-mint-deep"><CheckCircle2 aria-hidden /> Payment complete.</p>
            )}
            {st?.status === "failed" && (
              <>
                <p className="flex items-center gap-2 font-semibold text-danger"><XCircle aria-hidden /> It didn't go through</p>
                <ErrorNote compact error={friendlyError(new Error(st.error ?? "The network rejected this payment. No money moved."), { fromServer: true })} />
              </>
            )}
            {(!st || st.status === "submitted") && (
              <Notice tone="warn">Sent, but not confirmed yet. Don't send it again. Check back in a moment.</Notice>
            )}
            {state.error && <ErrorNote compact error={state.problem ?? state.error} />}
            {st?.explorerUrl && (
              <a className="link inline-flex items-center gap-1.5 text-sm" href={st.explorerUrl} target="_blank" rel="noreferrer">
                View on Stellar Expert <ExternalLink size={14} aria-hidden />
              </a>
            )}
            {st?.hash && <p className="tabular break-all text-xs text-slate">Tx {st.hash}</p>}
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              {(!st || st.status === "submitted") && <button className="btn-outline" onClick={onRecheck}>Check status</button>}
              <button className="btn-ink" onClick={onClose}>Done</button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
