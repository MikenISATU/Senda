import Link from "next/link";
import { Logo } from "@/components/Logo";
import { FeatureDemo } from "@/components/landing/FeatureDemo";
import { Partners } from "@/components/landing/Partners";

const WRAP = "mx-auto w-full max-w-[1320px] px-5 md:px-10";

const FEATURES = [
  { title: "Send", body: "Pay @maria, not a long code. It lands in seconds.", tag: "$12.50 sent", tone: "bg-cobalt-soft text-cobalt-deep" },
  { title: "Tip and sell", body: "Support posts you love. Sell the ones people pay to unlock.", tag: "+$1.95 tip", tone: "bg-mint-soft text-mint-deep" },
  { title: "Hire safely", body: "Your payment waits until you approve the work.", tag: "Held until done", tone: "bg-cobalt-soft text-cobalt-deep" },
  { title: "Save", body: "Optional savings that can grow. Coming after our safety review.", tag: "Coming later", tone: "bg-mint-soft text-mint-deep" },
];

const STEPS = [
  ["Sign up with your email", "No passwords or long codes to keep."],
  ["Pick a username", "Friends pay @you, nothing else to share."],
  ["Send, tip and hire", "You see every amount before you approve."],
];

const ROADMAP = [
  { when: "Done", title: "Build", body: "Wallet, feed, tips, paid posts and safe job payments." },
  { when: "Now", title: "Testnet", body: "Open preview with free test money. Try it and tell us what you think." },
  { when: "Next", title: "Safety review", body: "Independent security and legal checks before real money." },
  { when: "Later", title: "Launch", body: "Real payments, opened up step by step." },
];

const TEAM = [
  { name: "Miles Kenneth Napilan", role: "Founder and Developer", initials: "MN", tone: "bg-cobalt" },
  { name: "Alicia Amor Cerrudo", role: "Co-founder and Head of Business Development", initials: "AC", tone: "bg-mint-deep" },
];

const FAQ = [
  { q: "Do I need to know crypto?", a: "No. Sign up with your email and your account is set up for you. Nothing to install, no secret words to write down." },
  { q: "Is this real money?", a: "Not yet. The preview uses free test money, so you can try everything without risk." },
  { q: "What does it cost?", a: "Sending to friends is free apart from a tiny network fee, a fraction of a cent. Tips, sales and jobs have a small fee, always shown before you pay." },
  { q: "How is a job payment kept safe?", a: "The money is locked away when the job starts and only released when you approve, or refunded if the deadline passes. Senda can't take it." },
  { q: "Does my balance grow on its own?", a: "No. Save is coming later, after our safety review. When it launches it will be optional, rates will change, and there will be some risk." },
];

export default function Landing() {
  return (
    <div className="bg-cloud text-ink">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-white focus:px-3 focus:py-2">Skip to content</a>
      <header className="sticky top-0 z-40 border-b border-line/70 bg-cloud/85 backdrop-blur">
        <div className={`${WRAP} flex h-16 items-center justify-between`}>
          <Link href="/" className="flex items-center gap-2 font-display text-xl font-bold"><Logo /> Senda</Link>
          <nav aria-label="Primary" className="hidden items-center gap-1 lg:flex">
            {[["About", "#about"], ["How it works", "#how"], ["Roadmap", "#roadmap"], ["Team", "#team"], ["Partners", "#partners"]].map(([t, h]) => (
              <a key={h} href={h} className="tap inline-flex items-center rounded-full px-3 font-medium text-slate hover:text-ink">{t}</a>
            ))}
          </nav>
          <Link href="/login" className="btn-ink">Open Senda</Link>
        </div>
      </header>

      <main id="main">
        <section className={`${WRAP} grid min-h-[calc(100dvh-4rem)] items-center overflow-x-clip gap-10 py-12 lg:grid-cols-2 lg:gap-16`}>
          <div>
            <h1 className="font-display text-[clamp(2.6rem,5.4vw,4.9rem)] font-bold leading-[0.98] tracking-[-0.035em]">
              <span className="block">Send money.</span>
              <span className="block">Share moments.</span>
            </h1>
            <p className="mt-6 max-w-[30rem] text-lg text-slate">Pay friends by username, tip creators and hire people safely. One simple app.</p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link href="/login" className="btn-ink h-12 px-7 text-base">Open Senda</Link>
              <a href="#how" className="btn-outline h-12 px-6 text-base">How it works</a>
            </div>
            <p className="mt-5 text-sm text-slate">Free preview with test money. Nothing real moves yet.</p>
          </div>
          <FeatureDemo />
        </section>

        <section id="about" aria-labelledby="about-h" className="border-t border-line bg-white">
          <div className={`${WRAP} py-20 md:py-28`}>
            <h2 id="about-h" className="max-w-2xl text-4xl font-semibold md:text-5xl">Money, made social.</h2>
            <p className="mt-3 text-lg text-slate">Your feed and your wallet in one place.</p>
            <ul className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
              {FEATURES.map((f) => (
                <li key={f.title} className="flex flex-col rounded-[var(--radius-sheet)] bg-cloud p-6">
                  <span className={`self-start rounded-full px-3 py-1 text-xs font-bold ${f.tone}`}>{f.tag}</span>
                  <h3 className="mt-8 text-2xl font-semibold">{f.title}</h3>
                  <p className="mt-2 text-slate">{f.body}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section id="how" aria-labelledby="how-h" className={`${WRAP} py-20 md:py-28`}>
          <h2 id="how-h" className="text-4xl font-semibold md:text-5xl">How it works</h2>
          <ol className="mt-12 grid gap-10 md:grid-cols-3">
            {STEPS.map(([t, b], i) => (
              <li key={t} className="border-t-2 border-ink pt-5">
                <span className="font-display text-5xl font-bold text-cobalt">{i + 1}</span>
                <h3 className="mt-4 text-2xl font-semibold">{t}</h3>
                <p className="mt-2 text-slate">{b}</p>
              </li>
            ))}
          </ol>
        </section>

        <section id="roadmap" aria-labelledby="roadmap-h" className="bg-ink text-white">
          <div className={`${WRAP} py-20 md:py-28`}>
            <h2 id="roadmap-h" className="text-4xl font-semibold md:text-5xl">Roadmap</h2>
            <p className="mt-3 text-lg text-white/70">We're in testnet now.</p>
            <ol className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
              {ROADMAP.map((r) => {
                const now = r.when === "Now";
                return (
                  <li key={r.title} aria-current={now ? "step" : undefined} className={`rounded-[var(--radius-sheet)] p-6 ${now ? "bg-mint text-ink" : "bg-ink-2"}`}>
                    <span className={`text-xs font-bold uppercase tracking-widest ${now ? "text-ink/70" : r.when === "Done" ? "text-mint" : "text-white/50"}`}>
                      {now && <span className="mr-2 inline-block size-2 animate-pulse rounded-full bg-ink align-middle" />}{r.when}
                    </span>
                    <h3 className="mt-6 text-2xl font-semibold">{r.title}</h3>
                    <p className={`mt-2 ${now ? "text-ink/80" : "text-white/70"}`}>{r.body}</p>
                  </li>
                );
              })}
            </ol>
          </div>
        </section>

        <section id="team" aria-labelledby="team-h" className={`${WRAP} py-20 md:py-28`}>
          <h2 id="team-h" className="text-4xl font-semibold md:text-5xl">Team</h2>
          <p className="mt-3 text-lg text-slate">The people building Senda.</p>
          <ul className="mt-12 grid gap-5 md:grid-cols-2">
            {TEAM.map((m) => (
              <li key={m.name} className="flex items-center gap-5 rounded-[var(--radius-sheet)] bg-white p-6 ring-1 ring-line md:p-8">
                <span className={`grid size-20 shrink-0 place-items-center rounded-full font-display text-2xl font-bold text-white ${m.tone}`} aria-hidden>{m.initials}</span>
                <div>
                  <h3 className="text-2xl font-semibold">{m.name}</h3>
                  <p className="mt-1 text-slate">{m.role}</p>
                </div>
              </li>
            ))}
          </ul>
        </section>

        <section id="partners" aria-labelledby="partners-h" className="border-y border-line bg-white">
          <div className={`${WRAP} pt-20 md:pt-24`}>
            <h2 id="partners-h" className="text-4xl font-semibold md:text-5xl">Partners</h2>
            <p className="mt-3 text-lg text-slate">The network, tools and community Senda is built with.</p>
          </div>
          <div className="pb-16 pt-8 md:pb-20"><Partners /></div>
        </section>

        <section id="faq" aria-labelledby="faq-h" className={`${WRAP} py-20 md:py-28`}>
          <div className="grid gap-10 lg:grid-cols-[1fr_1.6fr]">
            <h2 id="faq-h" className="text-4xl font-semibold md:text-5xl">Questions</h2>
            <div className="divide-y divide-line border-y border-line">
              {FAQ.map((f) => (
                <details key={f.q} className="group py-1">
                  <summary className="tap flex cursor-pointer list-none items-center justify-between gap-4 py-3 font-display text-lg font-semibold">
                    {f.q}
                    <span aria-hidden className="text-2xl text-cobalt transition-transform group-open:rotate-45">+</span>
                  </summary>
                  <p className="pb-4 text-slate">{f.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        <section className="bg-white">
          <div className={`${WRAP} flex flex-col items-start justify-between gap-6 py-16 md:flex-row md:items-center md:py-20`}>
            <h2 className="max-w-xl text-3xl font-semibold md:text-5xl">Try it with free test money.</h2>
            <Link href="/login" className="btn-ink h-12 px-7 text-base">Open Senda</Link>
          </div>
        </section>
      </main>

      <footer className="border-t border-line">
        <div className={`${WRAP} flex flex-col gap-4 py-8 text-sm text-slate md:flex-row md:items-center md:justify-between`}>
          <p className="flex items-center gap-2"><Logo size={20} /> Senda. Testnet preview.</p>
          <nav aria-label="Footer" className="flex flex-wrap gap-x-5 gap-y-2">
            <a href="#about" className="hover:text-ink">About</a>
            <a href="#roadmap" className="hover:text-ink">Roadmap</a>
            <a href="#team" className="hover:text-ink">Team</a>
            <a href="#faq" className="hover:text-ink">Questions</a>
          </nav>
        </div>
      </footer>
    </div>
  );
}
