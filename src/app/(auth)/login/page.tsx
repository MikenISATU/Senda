"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useLoginWithEmail } from "@privy-io/react-auth";
import { Suspense, useEffect, useState } from "react";
import { Logo } from "@/components/Logo";
import { FeatureDemo } from "@/components/landing/FeatureDemo";
import { Notice, Spinner } from "@/components/ui/bits";
import { useSession } from "@/lib/client/session";

function EmailSignIn() {
  const { sendCode, loginWithCode, state } = useLoginWithEmail();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"email" | "code">("email");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setErr(null);
    try { await fn(); } catch (e) { setErr((e as Error).message || "Something went wrong. Try again."); } finally { setBusy(false); }
  }

  if (step === "email") {
    return (
      <form className="space-y-5" onSubmit={(e) => { e.preventDefault(); run(async () => { await sendCode({ email: email.trim() }); setStep("code"); }); }}>
        <div>
          <label className="label" htmlFor="email">Email</label>
          <input id="email" type="email" className="field h-12" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" autoComplete="email" required autoFocus />
        </div>
        {err && <Notice tone="danger">{err}</Notice>}
        <button className="btn-ink h-12 w-full rounded-xl text-base" disabled={busy || !email}>{busy ? "Sending code" : "Continue"}</button>
      </form>
    );
  }

  return (
    <form className="space-y-5" onSubmit={(e) => { e.preventDefault(); run(() => loginWithCode({ code: code.trim() })); }}>
      <div>
        <label className="label" htmlFor="code">6-digit code</label>
        <input id="code" className="field tabular h-12 text-lg tracking-[0.4em]" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" required autoFocus />
        <p className="hint">Sent to <b className="text-ink">{email}</b>. Check spam if it's not there.</p>
      </div>
      {(err || state.status === "error") && <Notice tone="danger">{err ?? "That code didn't work. Try again."}</Notice>}
      <button className="btn-ink h-12 w-full rounded-xl text-base" disabled={busy || code.length !== 6}>{busy ? "Checking" : "Sign in"}</button>
      <div className="flex justify-between text-sm">
        <button type="button" className="tap font-semibold text-cobalt-deep" onClick={() => { setStep("email"); setCode(""); setErr(null); }}>Use a different email</button>
        <button type="button" className="tap font-semibold text-cobalt-deep" disabled={busy} onClick={() => run(() => sendCode({ email: email.trim() }))}>Resend code</button>
      </div>
    </form>
  );
}

function LoginInner() {
  const s = useSession();
  const router = useRouter();
  const next = useSearchParams().get("next");
  useEffect(() => {
    if (s.status === "ready") router.replace(s.profile?.username ? (next?.startsWith("/") ? next : "/home") : "/onboarding");
  }, [s.status, s.profile?.username, next, router]);
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (s.status !== "loading") { setSlow(false); return; }
    const t = setTimeout(() => setSlow(true), 10000);
    return () => clearTimeout(t);
  }, [s.status]);

  return (
    <main className="grid min-h-dvh lg:grid-cols-2">
      <aside className="relative flex flex-col overflow-x-clip bg-ink px-6 py-8 text-white md:px-12 lg:py-10">
        <Link href="/" className="flex items-center gap-2 self-start font-display text-xl font-bold"><span className="inline-flex rounded-[7px] ring-1 ring-white/30"><Logo /></span> Senda</Link>
        <div className="mt-10 lg:my-auto lg:max-w-[480px]">
          <h1 className="font-display text-4xl font-bold leading-[1.02] tracking-tight md:text-5xl">Send money. Share moments.</h1>
          <p className="mt-4 text-lg text-white/75">Pay friends by username, tip creators and hire safely.</p>
          <div className="mt-10 hidden lg:block"><FeatureDemo tone="dark" /></div>
        </div>
        <p className="mt-8 hidden text-sm text-white/55 lg:block">Free preview with test money. Nothing real moves yet.</p>
      </aside>

      <section className="flex flex-col bg-cloud px-6 py-8 md:px-12 lg:py-10">
        <Link href="/" className="tap inline-flex items-center gap-1 self-start text-slate hover:text-ink">
          <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M15 6l-6 6 6 6" /></svg>
          Back
        </Link>
        <div className="mx-auto my-auto w-full max-w-[440px] py-10">
          <h2 className="text-4xl font-semibold">Welcome to Senda</h2>
          <p className="mt-2 text-slate">Sign in or create your account with your email. One step for both.</p>
          <div className="mt-8">
            {s.status === "signed-out" && <EmailSignIn />}
            {(s.status === "loading" || s.status === "provisioning" || s.status === "ready") && <Spinner label={s.status === "provisioning" ? "Setting up your account" : "Loading"} />}
            {s.status === "loading" && slow && (
              <div className="mt-4"><Notice tone="warn">Sign-in is taking longer than usual. Refresh the page. If it keeps happening, the site's address may not be allowed in the sign-in settings yet.</Notice></div>
            )}
            {s.status === "error" && <Notice tone="danger">{s.error}</Notice>}
          </div>
          <p className="mt-8 text-sm text-slate">Your account and wallet are made for you. Only you can approve a payment.</p>
        </div>
      </section>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginInner />
    </Suspense>
  );
}
