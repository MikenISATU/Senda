"use client";

import { useSignRawHash } from "@privy-io/react-auth/extended-chains";
import { createContext, useCallback, useContext, useRef, useState } from "react";
import { TxDialog } from "@/components/ui/TxDialog";
import { useSession } from "./session";
import type { IntentStatus, PreparedIntent } from "./types";

type Phase = "idle" | "preparing" | "review" | "signing" | "submitting" | "done" | "error";
export type TxState = { phase: Phase; intent: PreparedIntent | null; status: IntentStatus | null; error: string | null };

type Ctx = { run: (prepare: () => Promise<PreparedIntent>, opts?: { onConfirmed?: (s: IntentStatus) => void }) => void };
const TxCtx = createContext<Ctx | null>(null);

/**
 * One flow for every money movement:
 *   server prepares -> user reviews the exact summary -> Privy signs the tx hash
 *   -> server verifies signature against the stored tx and submits -> poll until final.
 * The UI never shows "success" until the server reports on-chain confirmation.
 */
export function TxProvider({ children }: { children: React.ReactNode }) {
  const { api } = useSession();
  const { signRawHash } = useSignRawHash();
  const [state, setState] = useState<TxState>({ phase: "idle", intent: null, status: null, error: null });
  const prepareRef = useRef<(() => Promise<PreparedIntent>) | null>(null);
  const cbRef = useRef<((s: IntentStatus) => void) | undefined>(undefined);

  const run: Ctx["run"] = useCallback(async (prepare, opts) => {
    prepareRef.current = prepare;
    cbRef.current = opts?.onConfirmed;
    setState({ phase: "preparing", intent: null, status: null, error: null });
    try {
      const intent = await prepare();
      setState({ phase: "review", intent, status: null, error: null });
    } catch (e) {
      setState({ phase: "error", intent: null, status: null, error: (e as Error).message });
    }
  }, []);

  const confirm = useCallback(async () => {
    const intent = state.intent;
    if (!intent) return;
    if (Date.parse(intent.expiresAt) < Date.now()) {
      setState((s) => ({ ...s, phase: "error", error: "This request expired before signing. Nothing was sent. Start again." }));
      return;
    }
    setState((s) => ({ ...s, phase: "signing" }));
    let signature: string;
    try {
      ({ signature } = await signRawHash({ address: intent.signer, chainType: "stellar", hash: `0x${intent.hash}` }));
    } catch (e) {
      setState((s) => ({ ...s, phase: "review", error: `Signing was cancelled or failed: ${(e as Error).message}` }));
      return;
    }
    setState((s) => ({ ...s, phase: "submitting", error: null }));
    try {
      let st = await api<IntentStatus>("/api/tx/submit", { body: { intentId: intent.intentId, signature } });
      for (let i = 0; i < 20 && st.status === "submitted"; i++) {
        await new Promise((r) => setTimeout(r, Math.min(1500 * (i + 1), 6000)));
        st = await api<IntentStatus>(`/api/tx/${intent.intentId}`);
      }
      setState((s) => ({ ...s, phase: "done", status: st }));
      if (st.status === "confirmed") cbRef.current?.(st);
    } catch (e) {
      // Uncertain: keep the original intent; the user can re-check, never re-sign blindly.
      setState((s) => ({ ...s, phase: "done", status: s.status, error: `${(e as Error).message}. Your transaction may still complete; check its status before trying again.` }));
    }
  }, [api, signRawHash, state.intent]);

  const recheck = useCallback(async () => {
    if (!state.intent) return;
    try {
      const st = await api<IntentStatus>(`/api/tx/${state.intent.intentId}`);
      setState((s) => ({ ...s, status: st, error: null }));
      if (st.status === "confirmed") cbRef.current?.(st);
    } catch (e) {
      setState((s) => ({ ...s, error: (e as Error).message }));
    }
  }, [api, state.intent]);

  const close = useCallback(() => setState({ phase: "idle", intent: null, status: null, error: null }), []);

  return (
    <TxCtx.Provider value={{ run }}>
      {children}
      <TxDialog state={state} onConfirm={confirm} onClose={close} onRecheck={recheck} />
    </TxCtx.Provider>
  );
}

export function useTx() {
  const v = useContext(TxCtx);
  if (!v) throw new Error("useTx outside TxProvider");
  return v;
}
