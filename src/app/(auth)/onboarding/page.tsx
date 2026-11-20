"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { FaucetPanel } from "@/components/app/FaucetPanel";
import { Logo } from "@/components/app/AppShell";
import { Notice, shortAddr, Spinner } from "@/components/ui/bits";
import { useSession } from "@/lib/client/session";

export default function Onboarding() {
  const s = useSession();
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (s.status === "signed-out") router.replace("/login");
  }, [s.status, router]);

  if (s.status !== "ready") return <main className="grid min-h-dvh place-items-center"><Spinner label={s.status === "provisioning" ? "Creating your Stellar wallet" : "Loading"} />{s.error && <Notice tone="danger">{s.error}</Notice>}</main>;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setErr(null);
    try {
      await s.api("/api/onboarding", { body: { username, displayName } });
      await s.refresh();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const hasName = !!s.profile?.username;
  return (
    <main className="mx-auto max-w-lg px-4 py-10">
      <div className="mb-8 flex items-center gap-2 font-display text-xl font-bold"><Logo /> Senda</div>
      <h1 className="text-3xl font-semibold">{hasName ? `You're @${s.profile!.username}` : "Pick your name"}</h1>
      <p className="mt-2 text-slate">Your wallet is ready: <span className="tabular font-semibold text-ink">{shortAddr(s.wallet)}</span>. People can pay you by username instead of this address.</p>

      {!hasName ? (
        <form onSubmit={save} className="sheet mt-6 space-y-4 p-5">
          <div>
            <label className="label" htmlFor="u">Username</label>
            <div className="flex items-center gap-2"><span className="text-slate" aria-hidden>@</span>
              <input id="u" className="field" value={username} onChange={(e) => setUsername(e.target.value.toLowerCase())} pattern="[a-z0-9_]{3,20}" required autoComplete="username" aria-describedby="u-hint" />
            </div>
            <p id="u-hint" className="hint">3 to 20 characters: letters, numbers, underscore. You can't change it later.</p>
          </div>
          <div>
            <label className="label" htmlFor="d">Display name</label>
            <input id="d" className="field" value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={50} required />
          </div>
          {err && <Notice tone="danger">{err}</Notice>}
          <button className="btn-primary w-full" disabled={saving}>{saving ? "Saving" : "Continue"}</button>
        </form>
      ) : (
        <section className="sheet mt-6 p-5" aria-labelledby="fund-h">
          <h2 id="fund-h" className="mb-4 text-xl font-semibold">Get test funds</h2>
          {s.config?.faucetEnabled ? <FaucetPanel compact /> : <Notice>The faucet is off on this network.</Notice>}
          <Link href="/home" className="btn-ink mt-6 w-full">Go to my feed</Link>
        </section>
      )}
    </main>
  );
}
