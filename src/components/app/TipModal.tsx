"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { useSession } from "@/lib/client/session";
import type { PreparedIntent } from "@/lib/client/types";
import { useTx } from "@/lib/client/useTx";

export function TipModal({ open, onClose, postId, username, onTipped }: { open: boolean; onClose: () => void; postId?: string; username: string; onTipped?: () => void }) {
  const { api, config } = useSession();
  const { run } = useTx();
  const [amount, setAmount] = useState("1");
  const [asset, setAsset] = useState<"USDC" | "XLM">("USDC");
  const fee = config ? config.platformFeeBps / 100 : 2.5;
  return (
    <Modal open={open} onClose={onClose} title={`Tip @${username}`}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onClose();
          run(() => api<PreparedIntent>("/api/tips/prepare", { body: { postId, username: postId ? undefined : username, amount, asset } }), { onConfirmed: onTipped });
        }}
        className="space-y-4"
      >
        <fieldset>
          <legend className="label">Amount</legend>
          <div className="flex flex-wrap gap-2">
            {["0.5", "1", "5", "10"].map((v) => (
              <button type="button" key={v} aria-pressed={amount === v} onClick={() => setAmount(v)} className={`btn-outline tabular ${amount === v ? "border-cobalt bg-cobalt-soft" : ""}`}>{v}</button>
            ))}
          </div>
          <label htmlFor="tip-custom" className="sr-only">Custom amount</label>
          <input id="tip-custom" className="field tabular mt-2" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </fieldset>
        <div>
          <label className="label" htmlFor="tip-asset">Asset</label>
          <select id="tip-asset" className="field" value={asset} onChange={(e) => setAsset(e.target.value as "USDC" | "XLM")}><option>USDC</option><option>XLM</option></select>
        </div>
        <p className="text-sm text-slate">The creator gets the tip minus a {fee}% platform fee, in one atomic transaction.</p>
        <button className="btn-primary w-full">Review tip</button>
      </form>
    </Modal>
  );
}
