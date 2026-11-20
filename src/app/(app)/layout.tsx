import { AppShell } from "@/components/app/AppShell";
import { Providers } from "@/components/Providers";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="senda-app">
      <Providers>
        <AppShell>{children}</AppShell>
      </Providers>
    </div>
  );
}
