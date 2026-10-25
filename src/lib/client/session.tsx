"use client";

import { usePrivy } from "@privy-io/react-auth";
import { useCreateWallet } from "@privy-io/react-auth/extended-chains";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { apiFetch, ApiError } from "./api";
import type { PublicConfig } from "./types";

type Profile = {
  id: string; username: string | null; display_name: string | null; bio: string | null; avatar_url: string | null;
  role: "user" | "admin" | "mediator"; onboarded_at: string | null; follower_count: number; following_count: number;
};

type SessionState = {
  status: "loading" | "signed-out" | "provisioning" | "ready" | "error";
  error: string | null;
  profile: Profile | null;
  wallet: string | null;
  config: PublicConfig | null;
  supabaseToken: string | null;
  api: <T>(path: string, init?: { method?: string; body?: unknown }) => Promise<T>;
  refresh: () => Promise<void>;
  login: () => void;
  logout: () => Promise<void>;
};

const Ctx = createContext<SessionState | null>(null);

/**
 * Bridges Privy auth to Senda:
 *   1. Privy email OTP login (Privy is the identity authority)
 *   2. POST /api/session with the Privy access token -> server verifies it and maps to a profile
 *   3. If the user has no Stellar wallet, create one in Privy (chainType "stellar")
 *   4. POST /api/wallet/register -> server re-checks ownership with Privy's API
 */
export function SessionProvider({ children }: { children: React.ReactNode }) {
  const { ready, authenticated, user, getAccessToken, login, logout: privyLogout } = usePrivy();
  const { createWallet } = useCreateWallet();
  const [s, setS] = useState<Omit<SessionState, "api" | "refresh" | "login" | "logout">>({
    status: "loading", error: null, profile: null, wallet: null, config: null, supabaseToken: null,
  });
  const provisioning = useRef(false);

  const api = useCallback(<T,>(path: string, init?: { method?: string; body?: unknown }) => apiFetch<T>(getAccessToken, path, init), [getAccessToken]);

  const refresh = useCallback(async () => {
    const r = await api<{ profile: Profile; wallet: string | null; supabase: { token: string } | null; config: PublicConfig }>("/api/session", { method: "POST", body: {} });
    setS((p) => ({ ...p, status: "ready", error: null, profile: r.profile, wallet: r.wallet, config: r.config, supabaseToken: r.supabase?.token ?? null }));
    return void r;
  }, [api]);

  useEffect(() => {
    if (!ready) return;
    if (!authenticated || !user) {
      setS({ status: "signed-out", error: null, profile: null, wallet: null, config: null, supabaseToken: null });
      return;
    }
    if (provisioning.current) return;
    provisioning.current = true;
    (async () => {
      try {
        setS((p) => ({ ...p, status: "provisioning" }));
        const sess = await api<{ profile: Profile; wallet: string | null; supabase: { token: string } | null; config: PublicConfig }>("/api/session", { method: "POST", body: {} });
        let wallet = sess.wallet;
        if (!wallet) {
          type LA = { type: string; chainType?: string; address?: string };
          let stellar = (user.linkedAccounts as unknown as LA[]).find((a) => a.type === "wallet" && a.chainType === "stellar")?.address;
          if (!stellar) {
            const created = await createWallet({ chainType: "stellar" });
            stellar = created.wallet.address;
          }
          const reg = await api<{ address: string }>("/api/wallet/register", { body: { address: stellar } });
          wallet = reg.address;
        }
        setS({ status: "ready", error: null, profile: sess.profile, wallet, config: sess.config, supabaseToken: sess.supabase?.token ?? null });
      } catch (e) {
        const msg = e instanceof ApiError && e.code === "NOT_CONFIGURED" ? `Server setup incomplete: ${e.message}` : (e as Error).message;
        setS((p) => ({ ...p, status: "error", error: msg }));
      } finally {
        provisioning.current = false;
      }
    })();
  }, [ready, authenticated, user, api, createWallet]);

  const value = useMemo<SessionState>(
    () => ({
      ...s,
      api,
      refresh,
      login,
      logout: async () => {
        await privyLogout();
        setS({ status: "signed-out", error: null, profile: null, wallet: null, config: null, supabaseToken: null });
      },
    }),
    [s, api, refresh, login, privyLogout],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useSession outside SessionProvider");
  return v;
}
