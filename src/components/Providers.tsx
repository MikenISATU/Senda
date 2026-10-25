"use client";

import { PrivyProvider } from "@privy-io/react-auth";
import { SWRConfig } from "swr";
import { SessionProvider } from "@/lib/client/session";
import { TxProvider } from "@/lib/client/useTx";

const APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID;
// Optional. Privy client IDs start with "client-". Anything else (an App ID or
// secret pasted here by mistake) makes Privy reject sign-in, so it is ignored.
const RAW_CLIENT_ID = process.env.NEXT_PUBLIC_PRIVY_CLIENT_ID?.trim();
const CLIENT_ID = RAW_CLIENT_ID?.startsWith("client-") ? RAW_CLIENT_ID : undefined;
if (RAW_CLIENT_ID && !CLIENT_ID && typeof window !== "undefined") {
  console.warn('NEXT_PUBLIC_PRIVY_CLIENT_ID is ignored: it should start with "client-". Leave it blank unless you created an app client in Privy.');
}

export function Providers({ children }: { children: React.ReactNode }) {
  if (!APP_ID) return <SetupNeeded />;
  return (
    <PrivyProvider
      appId={APP_ID}
      {...(CLIENT_ID ? { clientId: CLIENT_ID } : {})}
      config={{
        loginMethods: ["email"],
        appearance: { theme: "light", accentColor: "#4169F5", logo: "/icon.svg", landingHeader: "Sign in to Senda", showWalletLoginFirst: false },
      }}
    >
      <SWRConfig value={{ revalidateOnFocus: false, shouldRetryOnError: false }}>
        <SessionProvider>
          <TxProvider>{children}</TxProvider>
        </SessionProvider>
      </SWRConfig>
    </PrivyProvider>
  );
}

function SetupNeeded() {
  return (
    <main className="mx-auto max-w-xl px-4 py-16">
      <h1 className="text-3xl font-semibold">Almost there</h1>
      <p className="mt-3 text-slate">
        The app needs a Privy App ID before anyone can sign in. Add <code className="rounded bg-white px-1.5 py-0.5">NEXT_PUBLIC_PRIVY_APP_ID</code> to <code className="rounded bg-white px-1.5 py-0.5">.env.local</code>, then restart <code className="rounded bg-white px-1.5 py-0.5">pnpm dev</code>.
      </p>
      <p className="mt-3 text-slate">Step-by-step instructions are in START_HERE.md, section 5.</p>
    </main>
  );
}
