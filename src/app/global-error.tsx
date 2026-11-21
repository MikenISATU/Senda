"use client";

/** Last resort if the whole app fails to start. Kept dependency-free on purpose. */
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, minHeight: "100dvh", display: "grid", placeItems: "center", background: "#F5F7FC", color: "#101B2D", fontFamily: "system-ui, sans-serif", padding: 24 }}>
        <div style={{ maxWidth: 420, textAlign: "center" }}>
          <h1 style={{ fontSize: 24, margin: "0 0 8px" }}>Senda couldn't open</h1>
          <p style={{ margin: "0 0 20px", color: "#5B6B85" }}>Something went wrong on our side. No money was moved. Please try again.</p>
          <button onClick={reset} style={{ minHeight: 48, padding: "0 24px", borderRadius: 999, border: 0, background: "#101B2D", color: "#fff", fontSize: 16, fontWeight: 600, width: "100%" }}>Try again</button>
        </div>
      </body>
    </html>
  );
}
