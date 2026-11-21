import Link from "next/link";
import { Logo } from "@/components/Logo";

export default function NotFound() {
  return (
    <main className="grid min-h-dvh place-items-center bg-cloud px-6 text-ink">
      <div className="max-w-md text-center">
        <span className="inline-block"><Logo size={56} /></span>
        <h1 className="mt-5 text-3xl font-semibold">We couldn't find that page</h1>
        <p className="mt-2 text-slate">The link may be old, or the page was moved.</p>
        <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
          <Link href="/home" className="btn-ink">Open Senda</Link>
          <Link href="/" className="btn-outline">Go to the home page</Link>
        </div>
      </div>
    </main>
  );
}
