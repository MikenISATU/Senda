"use client";

import { ArrowDownLeft, ArrowUpRight, Bell, Briefcase, Compass, Home, MessageCircle, Plus, Settings, Shield, Wallet } from "lucide-react";
import useSWR from "swr";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { Amount, Avatar, Notice, Spinner } from "@/components/ui/bits";
import { useSession } from "@/lib/client/session";
import { Logo } from "@/components/Logo";

export { Logo };

const NAV = [
  { href: "/home", label: "Home", icon: Home },
  { href: "/explore", label: "Explore", icon: Compass },
  { href: "/messages", label: "Messages", icon: MessageCircle },
  { href: "/jobs", label: "Jobs", icon: Briefcase },
  { href: "/wallet", label: "Wallet", icon: Wallet },
  { href: "/notifications", label: "Notifications", icon: Bell },
  { href: "/settings", label: "Settings", icon: Settings },
];
const MOBILE = [NAV[0], NAV[1], { href: "/home#compose", label: "Post", icon: Plus }, NAV[3], NAV[4]];

export function AppShell({ children }: { children: React.ReactNode }) {
  const s = useSession();
  const path = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (s.status === "signed-out") router.replace(`/login?next=${encodeURIComponent(path)}`);
    if (s.status === "ready" && !s.profile?.username && path !== "/onboarding") router.replace("/onboarding");
  }, [s.status, s.profile?.username, path, router]);

  if (s.status === "error") {
    return (
      <main className="mx-auto max-w-lg px-4 py-16">
        <Notice tone="danger">{s.error}</Notice>
        <button className="btn-outline mt-4" onClick={() => location.reload()}>Try again</button>
      </main>
    );
  }
  if (s.status !== "ready" || !s.profile?.username) {
    return (
      <main className="grid min-h-dvh place-items-center">
        <Spinner label={s.status === "provisioning" ? "Setting up your Stellar wallet" : "Loading"} />
      </main>
    );
  }
  const active = (href: string) => path === href || (href !== "/home" && path.startsWith(href));
  const nav = s.profile.role === "user" ? NAV : [...NAV, { href: "/admin", label: "Admin", icon: Shield }];

  const greet = (() => { const h = new Date().getHours(); return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening"; })();

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-[1480px]">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-white focus:px-3 focus:py-2">Skip to content</a>
      <aside className="sticky top-0 hidden h-dvh w-[248px] shrink-0 flex-col px-4 py-6 md:flex lg:w-[272px]">
        <Link href="/home" className="mb-8 flex items-center gap-2.5 px-3 font-display text-2xl font-bold"><Logo size={30} /> Senda</Link>
        <nav aria-label="Main" className="flex flex-col gap-1">
          {nav.map(({ href, label, icon: Icon }) => {
            const on = active(href);
            return (
              <Link key={href} href={href} aria-current={on ? "page" : undefined}
                className={`tap group flex items-center gap-3 rounded-2xl px-3.5 text-[15px] font-semibold transition-colors ${on ? "bg-ink text-white shadow-[0_8px_20px_-10px_rgba(16,27,45,0.6)]" : "text-slate hover:bg-white hover:text-ink"}`}>
                <span className={`grid size-8 place-items-center rounded-xl ${on ? "bg-white/10 text-mint" : "bg-white text-ink ring-1 ring-line group-hover:ring-cobalt/30"}`}><Icon size={17} aria-hidden /></span>
                {label}
              </Link>
            );
          })}
        </nav>
        <Link href="/home#compose" className="btn-primary mt-6 h-12 rounded-2xl"><Plus size={18} aria-hidden /> New post</Link>
        <Link href={`/u/${s.profile.username}`} className="mt-auto flex items-center gap-3 rounded-2xl bg-white p-3 ring-1 ring-line hover:ring-cobalt/40">
          <Avatar src={s.profile.avatar_url} name={s.profile.username} size={40} />
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold">{s.profile.display_name}</span>
            <span className="block truncate text-sm text-slate">@{s.profile.username}</span>
          </span>
        </Link>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col md:border-x md:border-line md:bg-white/40">
        <header className="sticky top-0 z-20 flex items-center justify-between border-b border-line bg-cloud/90 px-4 py-2 backdrop-blur md:hidden">
          <Link href="/home" className="flex items-center gap-2 font-display text-lg font-bold"><Logo /> Senda</Link>
          <div className="flex items-center">
            <Link href="/messages" aria-label="Messages" className="tap inline-flex items-center justify-center"><MessageCircle size={22} /></Link>
            <Link href="/notifications" aria-label="Notifications" className="tap inline-flex items-center justify-center"><Bell size={22} /></Link>
            <Link href="/settings" aria-label="Settings" className="tap inline-flex items-center justify-center"><Avatar src={s.profile.avatar_url} name={s.profile.username} size={28} /></Link>
          </div>
        </header>
        <div className="hidden items-center justify-between gap-4 px-6 pt-6 md:flex">
          <p className="text-slate">{greet}, <span className="font-semibold text-ink">{s.profile.display_name ?? `@${s.profile.username}`}</span></p>
          {s.config?.network === "testnet" && (
            <span className="inline-flex items-center gap-2 rounded-full bg-mint-soft px-3 py-1 text-xs font-bold text-mint-deep"><span className="size-1.5 rounded-full bg-mint" /> Test money only</span>
          )}
        </div>
        {s.config?.network === "testnet" && (
          <p className="bg-mint-soft px-4 py-1.5 text-center text-xs font-semibold text-mint-deep md:hidden">Test mode: balances are free test money.</p>
        )}
        <main id="main" className="min-w-0 flex-1 pb-28 md:pb-12">{children}</main>
      </div>

      <RightRail />

      <nav aria-label="Main" className="fixed inset-x-3 bottom-3 z-30 rounded-3xl bg-ink pb-[env(safe-area-inset-bottom)] shadow-2xl md:hidden">
        <ul className="grid grid-cols-5">
          {MOBILE.map(({ href, label, icon: Icon }) => {
            const on = active(href);
            return (
              <li key={label}>
                <Link href={href} aria-current={on ? "page" : undefined}
                  className={`flex min-h-16 flex-col items-center justify-center gap-0.5 text-[11px] font-semibold ${on ? "text-mint" : "text-white/70"}`}>
                  {label === "Post" ? <span className="grid size-10 place-items-center rounded-2xl bg-mint text-ink"><Icon size={20} aria-hidden /></span> : <Icon size={22} aria-hidden />}
                  <span className={label === "Post" ? "sr-only" : ""}>{label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}

type WalletSummary = { address: string | null; balances: { exists: boolean; xlm: string; usdc: string | null } | null };

/** Desktop right column: balance at a glance and quick actions. Shares the /api/wallet cache with the wallet page. */
function RightRail() {
  const { api, config } = useSession();
  const w = useSWR("/api/wallet", (u: string) => api<WalletSummary>(u), { refreshInterval: 30_000 });
  const b = w.data?.balances;
  return (
    <aside className="sticky top-0 hidden h-dvh w-[340px] shrink-0 flex-col gap-4 overflow-y-auto px-5 py-6 xl:flex">
      <section aria-label="Balance" className="relative overflow-hidden rounded-3xl bg-ink p-5 text-white">
        <div aria-hidden className="absolute -right-10 -top-12 size-40 rounded-full bg-cobalt/40 blur-2xl" />
        <div aria-hidden className="absolute -bottom-14 -left-8 size-36 rounded-full bg-mint/30 blur-2xl" />
        <div className="relative">
          <p className="text-sm text-white/65">Balance</p>
          {!w.data ? <div className="mt-3"><Spinner label="Loading" /></div> : (
            <>
              <p className="mt-1 font-display text-4xl font-bold tracking-tight"><span className="text-white/60">$</span><Amount value={b?.usdc ?? "0"} decimals={2} /></p>
              <p className="mt-1 text-sm text-white/65"><Amount value={b?.xlm ?? "0"} decimals={2} /> XLM</p>
            </>
          )}
          <div className="mt-5 grid grid-cols-3 gap-2">
            {[
              { href: "/wallet", label: "Send", icon: ArrowUpRight },
              { href: "/wallet#receive", label: "Receive", icon: ArrowDownLeft },
              { href: config?.faucetEnabled ? "/wallet#faucet" : "/wallet", label: config?.faucetEnabled ? "Add" : "History", icon: config?.faucetEnabled ? Plus : Wallet },
            ].map(({ href, label, icon: Icon }) => (
              <Link key={label} href={href} className="flex flex-col items-center gap-1.5 rounded-2xl bg-white/10 py-3 text-xs font-semibold hover:bg-white/15">
                <span className="grid size-8 place-items-center rounded-xl bg-mint text-ink"><Icon size={16} aria-hidden /></span>{label}
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section className="rounded-3xl bg-white p-5 ring-1 ring-line">
        <h2 className="text-base font-semibold">Things to try</h2>
        <ul className="mt-3 space-y-2.5 text-sm">
          {[
            { href: "/wallet#faucet", t: "Claim free test money", d: "Start with a few test dollars", icon: Plus },
            { href: "/explore", t: "Find people to follow", d: "Fill your feed", icon: Compass },
            { href: "/jobs", t: "Post or take a job", d: "Payment is held until done", icon: Briefcase },
          ].map(({ href, t, d, icon: Icon }) => (
            <li key={t}>
              <Link href={href} className="flex items-center gap-3 rounded-2xl p-2 hover:bg-cloud">
                <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-cobalt-soft text-cobalt-deep"><Icon size={17} aria-hidden /></span>
                <span><span className="block font-semibold text-ink">{t}</span><span className="text-slate">{d}</span></span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
      <p className="px-2 text-xs text-slate">Senda preview. Balances are test money with no real value.</p>
    </aside>
  );
}

export function PageHeader({ title, children, flush = false }: { title: string; children?: React.ReactNode; flush?: boolean }) {
  return (
    <div className={`flex flex-wrap items-center justify-between gap-3 pb-4 pt-5 md:pt-4 ${flush ? "" : "px-4 md:px-6"}`}>
      <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">{title}</h1>
      {children}
    </div>
  );
}
