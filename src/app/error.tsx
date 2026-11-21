"use client";

import { useEffect } from "react";
import { ErrorScreen } from "@/components/ui/ErrorNote";
import { friendlyError, logError } from "@/lib/client/errors";

/** Shown if a page outside the signed-in app crashes. */
export default function PageError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { logError("page", friendlyError(error), { digest: error.digest }); }, [error]);
  return <div className="bg-cloud text-ink"><ErrorScreen error={error} onRetry={reset} /></div>;
}
