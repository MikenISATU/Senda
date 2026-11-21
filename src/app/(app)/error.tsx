"use client";

import { useEffect } from "react";
import { ErrorScreen } from "@/components/ui/ErrorNote";
import { friendlyError, logError } from "@/lib/client/errors";

/** Shown inside the app frame if one screen crashes; the menu keeps working. */
export default function ScreenError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { logError("screen", friendlyError(error), { digest: error.digest }); }, [error]);
  return <ErrorScreen error={error} onRetry={reset} />;
}
