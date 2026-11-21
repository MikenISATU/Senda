"use client";

import { ArrowDownLeft, ArrowUpRight, Bell, Briefcase, Compass, Home, MessageCircle, Plus, Search, Settings, Shield, Wallet, X } from "lucide-react";
import useSWR from "swr";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Amount, Avatar } from "@/components/ui/bits";
import { ErrorScreen, OfflineBar } from "@/components/ui/ErrorNote";
import { Skeleton, Splash } from "@/components/ui/Loading";
import { useSession } from "@/lib/client/session";
import { Logo } from "@/components/Logo";
import { PeopleSearch } from "./PeopleSearch";
import { ThemeToggle } from "./ThemeToggle";

export { Logo };

const NAV = [
  { href: "/home", label: "Home", icon: Home },
  { href: "/explore", label: "Explore", icon: Compass },
  { href: "/messages", label: "Chats", icon: MessageCircle },
  { href: "/jobs", label: "Jobs", icon: Briefcase },
  { href: "/wallet", label: "Wallet", icon: Wallet },
  { href: "/settings", label: "Settings", icon: Settings },
];
const MOBILE = [NAV[0], NAV[3], { href: "/home#compose", label: "Post", icon: Plus }, NAV[2], NAV[4]];

export function AppShell({ children }: { children: React.ReactNode }) {
  const s = useSession();
  const path = usePathname();
  const router = useRouter();
  const [searchOpen, setSearchOpen] = useState(false);

  useEffect(() => {
    if (s.status === "signed-out") router.replace(`/login?next=${encodeURIComponent(path)}`);
    if (s.status === "ready" && !s.profile?.username && path !== "/onboarding") router.replace("/onboarding");
  }, [s.status, s.profile?.username, path, router]);

  if (s.status === "error") {
    return (
      <ErrorScreen error={s.error ?? "Senda couldn't load your account."} />
    );
  }
  if (s.status !== "ready" || !s.profile?.username) {
    return (
      <Splash label={s.status === "provisioning" ? "Setting up your wallet" : "Opening Senda"} />
    );
  }
  const active = (href: string) => path === href || (href !== "/home" && path.startsWith(href));
  const nav = s.profile.role === "user" ? NAV : [...NAV, { href: "/admin", label: "Admin", icon: Shield }];
  const name = s.profile.display_name ?? `@${s.profile.username}`;

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-[1480px]">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-white focus:px-3 focus:py-2">Skip to content</a>

      <aside className="sticky top-0 hidden h-dvh w-[232px] shrink-0 flex-col px-4 py-6 md:flex lg:w-[256px]">
        <Link href="/home" className="mb-8 flex items-center gap-2.5 px-3 font-display text-2xl font-bold">
          <span className="inline-flex rounded-[9px] ring-1 ring-line"><Logo size={30} /></span> Senda
        </Link>
        <nav aria-label="Main" className="flex flex-col gap-1.5">
          {nav.map(({ href, label, icon: Icon }) => {
            const on = active(href);
            return (
              <Link key={href} href={href} aria-current={on ? "page" : undefined}
                className={`tap flex items-center gap-3 rounded-2xl px-3 text-[15px] font-semibold transition-colors ${on ? "bg-white text-ink ring-1 ring-line" : "text-slate hover:bg-white/60 hover:text-ink"}`}>
                <span className={`grid size-9 place-items-center rounded-xl ${on ? "grad" : "bg-white ring-1 ring-line"}`}><Icon size={18} aria-hidden /></span>
                {label}
              </Link>
            );
          })}
        </nav>
        <Link href="/home#compose" className="btn-primary mt-6 h-12 rounded-2xl"><Plus size={18} aria-hidden /> Post</Link>
        <Link href={`/u/${s.profile.username}`} className="mt-auto flex items-center gap-3 rounded-2xl bg-white p-3 ring-1 ring-line hover:ring-cobalt">
          <span className="ring-grad"><span className="block rounded-full bg-white p-0.5"><Avatar src={s.profile.avatar_url} name={s.profile.username} size={36} /></span></span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold">{s.profile.display_name}</span>
            <span className="block truncate text-sm text-slate">@{s.profile.username}</span>
          </span>
        </Link>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <OfflineBar />
        <header className="sticky top-0 z-20 flex flex-wrap items-center justify-between gap-x-3 gap-y-2 bg-cloud/85 px-4 py-3 backdrop-blur md:static md:bg-transparent md:px-6 md:pt-6 md:backdrop-blur-none">
          <Link href={`/u/${s.profile.username}`} className="flex min-w-0 shrink items-center gap-3">
            <span className="ring-grad md:hidden"><span className="block rounded-full bg-cloud p-0.5"><Avatar src={s.profile.avatar_url} name={s.profile.username} size={36} /></span></span>
            <span className="min-w-0">
              <span className="block text-xs text-slate">Welcome back</span>
              <span className="block truncate font-display text-xl font-bold leading-tight">{name}</span>
            </span>
          </Link>
          <div className="flex items-center gap-2">
            {s.config?.network === "testnet" && <span className="hidden rounded-full bg-mint-soft px-3 py-1.5 text-xs font-bold text-mint-deep sm:inline">Test money</span>}
            <div className="hidden w-64 lg:block xl:w-72"><PeopleSearch /></div>
            <span className="lg:hidden"><button type="button" aria-label={searchOpen ? "Close search" : "Search people"} aria-expanded={searchOpen} onClick={() => setSearchOpen(!searchOpen)} className="icon-btn">{searchOpen ? <X size={19} /> : <Search size={19} />}</button></span>
            <ThemeToggle />
            <Link href="/notifications" aria-label="Notifications" className="icon-btn"><Bell size={19} /></Link>
          </div>
          {searchOpen && <div className="w-full lg:hidden"><PeopleSearch autoFocus onNavigate={() => setSearchOpen(false)} /></div>}
        </header>
        <main id="main" className="min-w-0 flex-1 pb-28 md:pb-12">{children}</main>
      </div>

      <RightRail />

      <nav aria-label="Main" className="fixed inset-x-4 bottom-3 z-30 rounded-[1.75rem] bg-white/90 pb-[env(safe-area-inset-bottom)] shadow-2xl ring-1 ring-line backdrop-blur md:hidden">
        <ul className="grid grid-cols-5">
          {MOBILE.map(({ href, label, icon: Icon }) => {
            const on = active(href) && label !== "Post";
            return (
              <li key={label}>
                <Link href={href} aria-current={on ? "page" : undefined} aria-label={label}
                  className={`flex min-h-16 flex-col items-center justify-center gap-1 ${on ? "text-ink" : "text-slate"}`}>
                  {label === "Post" ? <span className="grad grid size-11 place-items-center rounded-2xl"><Icon size={22} aria-hidden /></span> : <Icon size={23} aria-hidden strokeWidth={on ? 2.4 : 1.9} />}
                  {label !== "Post" && <span className={`size-1.5 rounded-full ${on ? "bg-mint" : "bg-transparent"}`} aria-hidden />}
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
type Person = { id: string; username: string; display_name: string | null; avatar_url: string | null; following: boolean };

/** Desktop right column: balance, quick actions and people. Shares caches with the wallet page and Home. */
function RightRail() {
  const { api, config } = useSession();
  const w = useSWR("/api/wallet", (u: string) => api<WalletSummary>(u), { refreshInterval: 30_000 });
  const people = useSWR("/api/follows", (u: string) => api<Person[]>(u));
  const b = w.data?.balances;
  return (
    <aside className="sticky top-0 hidden h-dvh w-[336px] shrink-0 flex-col gap-4 overflow-y-auto px-5 py-6 xl:flex">
      <section aria-label="Balance" className="hero-card relative overflow-hidden rounded-[1.75rem] p-5">
        <div aria-hidden className="absolute -right-10 -top-14 size-44 rounded-full bg-snow/10 blur-2xl" />
        <div className="relative">
          <p className="text-sm text-snow/70">Balance</p>
          {!w.data ? <span role="status" className="mt-2 block space-y-2"><span className="sr-only">Loading your balance</span><Skeleton className="h-10 w-40 opacity-40" /><Skeleton className="h-4 w-24 opacity-40" /></span> : (
            <>
              <p className="mt-1 font-display text-[2.6rem] font-bold leading-none tracking-tight"><span className="text-snow/60">$</span><Amount value={b?.usdc ?? "0"} decimals={2} /></p>
              <p className="mt-2 text-sm text-snow/70"><Amount value={b?.xlm ?? "0"} decimals={2} /> XLM</p>
            </>
          )}
          <div className="mt-5 grid grid-cols-3 gap-2">
            {[
              { href: "/wallet", label: "Send", icon: ArrowUpRight },
              { href: "/wallet#receive", label: "Receive", icon: ArrowDownLeft },
              { href: config?.faucetEnabled ? "/wallet#faucet" : "/wallet", label: config?.faucetEnabled ? "Top up" : "History", icon: config?.faucetEnabled ? Plus : Wallet },
            ].map(({ href, label, icon: Icon }) => (
              <Link key={label} href={href} className="flex flex-col items-center gap-1.5 rounded-2xl bg-snow/10 py-3 text-xs font-semibold text-snow hover:bg-snow/20">
                <span className="grid size-8 place-items-center rounded-xl bg-snow text-night"><Icon size={16} aria-hidden /></span>{label}
              </Link>
            ))}
          </div>
        </div>
      </section>

      {!!people.data?.length && (
        <section className="rounded-[1.75rem] bg-white p-5 ring-1 ring-line">
          <h2 className="text-base font-semibold">People</h2>
          <ul className="mt-3 space-y-1">
            {people.data.slice(0, 5).map((p) => (
              <li key={p.id}>
                <Link href={`/u/${p.username}`} className="flex items-center gap-3 rounded-2xl p-2 hover:bg-cloud">
                  <span className={p.following ? "ring-grad" : "ring-quiet"}><span className="block rounded-full bg-white p-0.5"><Avatar src={p.avatar_url} name={p.username} size={34} /></span></span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">{p.display_name ?? p.username}</span>
                    <span className="block truncate text-xs text-slate">@{p.username}</span>
                  </span>
                  {!p.following && <span className="rounded-full bg-cobalt-soft px-3 py-1 text-xs font-bold text-cobalt-deep">View</span>}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
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
