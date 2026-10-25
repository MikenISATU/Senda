"use client";

import { ExternalLink } from "lucide-react";
import { useState } from "react";
import useSWR from "swr";
import { Notice, Spinner } from "@/components/ui/bits";
import { useSession } from "@/lib/client/session";
import type { PreparedIntent } from "@/lib/client/types";
import { useTx } from "@/lib/client/useTx";

type Status = {
  enabled: boolean; reason?: string; network: string; accountExists: boolean; hasUsdcTrustline: boolean;
  signup: { xlm: boolean; usdc: boolean }; nextRepeatAt: { XLM: string | null; USDC: string | null };
  amounts: { repeatXlm: number; repeatUsdc: number; signupUsdc: number };
  recent: { id: string; asset: string; amount: string; kind: string; status: string; tx_hash: string | null; created_at: string }[];
};

const EXPLORER = "https://stellar.expert/explorer/testnet/tx/";

/** Testnet onboarding: activate account -> enable USDC -> claim test USDC, plus limited repeat claims. */
export function FaucetPanel({ compact = false, onChange }: { compact?: boolean; onChange?: () => void }) {
  const { api } = useSession();
  const { run } = useTx();
  const { data, mutate, isLoading } = useSWR("/api/faucet", (u: string) => api<Status>(u));
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: "success" | "danger"; text: string; link?: string } | null>(null);

  async function claim(kind: "signup" | "repeat", asset: "XLM" | "USDC") {
    setBusy(`${kind}-${asset}`);
    setMsg(null);
    try {
      const r = await api<{ status: string; hash: string | null; explorerUrl: string | null; note?: string }>("/api/faucet", { body: { kind, asset } });
      setMsg({ tone: "success", text: r.note ?? (r.status === "confirmed" ? `${asset} received and confirmed on-chain.` : `${asset} sent; waiting for confirmation.`), link: r.explorerUrl ?? undefined });
      await mutate();
      onChange?.();
    } catch (e) {
      setMsg({ tone: "danger", text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }

  if (isLoading || !data) return <Spinner label="Checking your test funds" />;
  if (!data.enabled) return <Notice tone="info">{data.reason}</Notice>;

  const step = !data.accountExists ? 1 : !data.hasUsdcTrustline ? 2 : !data.signup.usdc ? 3 : 4;
  return (
    <div className="space-y-4">
      <ol className="space-y-3">
        <Step n={1} done={data.accountExists} title="Activate your account" body="Stellar accounts need a small XLM balance to exist. Friendbot sends free testnet XLM.">
          {step === 1 && <button className="btn-primary" disabled={!!busy} onClick={() => claim("signup", "XLM")}>{busy ? "Activating" : "Get testnet XLM"}</button>}
        </Step>
        <Step n={2} done={data.hasUsdcTrustline} title="Enable USDC" body="Opt in to Circle's testnet USDC. This locks 0.5 XLM as a reserve.">
          {step === 2 && (
            <button className="btn-primary" onClick={() => run(() => api<PreparedIntent>("/api/trustline/prepare", { body: {} }), { onConfirmed: () => { mutate(); onChange?.(); } })}>Enable USDC</button>
          )}
        </Step>
        <Step n={3} done={data.signup.usdc} title={`Claim ${data.amounts.signupUsdc} test USDC`} body="A one-time welcome amount from the Senda testnet treasury.">
          {step === 3 && <button className="btn-primary" disabled={!!busy} onClick={() => claim("signup", "USDC")}>{busy ? "Sending" : "Claim test USDC"}</button>}
        </Step>
      </ol>

      {step === 4 && !compact && (
        <div className="rounded-xl border border-line p-4">
          <p className="font-semibold">Need more test funds?</p>
          <p className="text-sm text-slate">One claim per asset per window, with daily limits.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {(["XLM", "USDC"] as const).map((a) => {
              const next = data.nextRepeatAt[a];
              return (
                <button key={a} className="btn-outline" disabled={!!busy || !!next} onClick={() => claim("repeat", a)}>
                  {next ? `${a} again ${new Date(next).toLocaleString()}` : `Claim ${a === "XLM" ? data.amounts.repeatXlm : data.amounts.repeatUsdc} ${a}`}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {msg && (
        <Notice tone={msg.tone}>
          {msg.text}{" "}
          {msg.link && <a className="link inline-flex items-center gap-1" href={msg.link} target="_blank" rel="noreferrer">View transaction <ExternalLink size={13} aria-hidden /></a>}
        </Notice>
      )}

      {!compact && data.recent.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer font-semibold">Claim history</summary>
          <ul className="mt-2 divide-y divide-line">
            {data.recent.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-3 py-2">
                <span className="tabular">{Number(r.amount)} {r.asset} <span className="text-slate">({r.kind}, {r.status})</span></span>
                {r.tx_hash && <a className="link" href={EXPLORER + r.tx_hash} target="_blank" rel="noreferrer">Tx</a>}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function Step({ n, done, title, body, children }: { n: number; done: boolean; title: string; body: string; children?: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span aria-hidden className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-sm font-bold ${done ? "bg-mint text-ink" : "bg-white text-slate ring-1 ring-line"}`}>{done ? "✓" : n}</span>
      <div className="min-w-0 flex-1">
        <p className="font-semibold">{title} {done && <span className="sr-only">(done)</span>}</p>
        <p className="text-sm text-slate">{body}</p>
        {children && <div className="mt-2">{children}</div>}
      </div>
    </li>
  );
}
