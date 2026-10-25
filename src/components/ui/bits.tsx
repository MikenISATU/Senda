import { AlertTriangle, CheckCircle2, Info, Loader2 } from "lucide-react";
import { formatAmount } from "@/lib/stellar/amount";

export function Spinner({ label = "Loading" }: { label?: string }) {
  return (
    <span role="status" className="inline-flex items-center gap-2 text-slate">
      <Loader2 className="animate-spin" size={18} aria-hidden />
      <span className="text-sm">{label}</span>
    </span>
  );
}

export function Notice({ tone = "info", children }: { tone?: "info" | "warn" | "danger" | "success"; children: React.ReactNode }) {
  const styles = {
    info: "bg-cobalt-soft text-ink",
    warn: "bg-warn-soft text-warn",
    danger: "bg-danger-soft text-danger",
    success: "bg-mint-soft text-mint-deep",
  }[tone];
  const Icon = { info: Info, warn: AlertTriangle, danger: AlertTriangle, success: CheckCircle2 }[tone];
  return (
    <div role={tone === "danger" ? "alert" : "note"} className={`flex gap-2.5 rounded-xl px-3.5 py-3 text-sm ${styles}`}>
      <Icon size={18} className="mt-0.5 shrink-0" aria-hidden />
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export function Amount({ value, asset, className = "", decimals = 2 }: { value: string | number; asset?: string; className?: string; decimals?: number }) {
  return (
    <span className={`tabular ${className}`}>
      {formatAmount(String(value), decimals)}
      {asset ? <span className="ml-1 text-[0.8em] font-semibold text-slate">{asset}</span> : null}
    </span>
  );
}

export function Avatar({ src, name, size = 40 }: { src?: string | null; name?: string | null; size?: number }) {
  const initials = (name ?? "?").replace(/^@/, "").slice(0, 2).toUpperCase();
  return src ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt="" width={size} height={size} className="shrink-0 rounded-full object-cover" style={{ width: size, height: size }} />
  ) : (
    <span aria-hidden className="inline-flex shrink-0 items-center justify-center rounded-full bg-ink font-display text-sm font-semibold text-mint" style={{ width: size, height: size }}>
      {initials}
    </span>
  );
}

export function Empty({ title, children, action }: { title: string; children?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="px-6 py-14 text-center">
      <p className="font-display text-lg font-semibold">{title}</p>
      {children && <p className="mx-auto mt-1.5 max-w-sm text-slate">{children}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function shortAddr(a?: string | null) {
  return a ? `${a.slice(0, 5)}...${a.slice(-5)}` : "";
}

export function timeAgo(iso: string) {
  const s = Math.max(1, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d`;
  return new Date(iso).toLocaleDateString();
}
