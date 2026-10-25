import type { Metadata, Viewport } from "next";
import "@fontsource-variable/space-grotesk";
import "@fontsource-variable/manrope";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Senda | Send money. Share moments.", template: "%s | Senda" },
  description: "Pay friends by username, tip creators, sell posts and hire people safely, all in one simple app.",
};

export const viewport: Viewport = { themeColor: "#101B2D", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
