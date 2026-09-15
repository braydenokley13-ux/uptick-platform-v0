import type { Metadata } from "next";
import Link from "next/link";
import "@fontsource/geist-sans/400.css";
import "@fontsource/geist-sans/500.css";
import "@fontsource/geist-sans/600.css";
import "@fontsource/geist-mono/400.css";
import "@fontsource/newsreader/400-italic.css";
import "./globals.css";
import { demoMode, assertDemoEnvironment } from "@/lib/demo-guard";
export const metadata: Metadata = {
  title: "Uptick Local — Good things come around",
  description:
    "Your free local membership. A worthwhile perk nearby. A reason to come around.",
  robots: { index: false, follow: false },
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  if (demoMode()) assertDemoEnvironment();
  return (
    <html lang="en">
      <body className={demoMode() ? "demo-mode" : undefined}>
        {demoMode() && (
          <aside className="demo-banner">
            <strong>DEMO · SAMPLE DATA · NO REAL SMS</strong>
            <Link href="/demo">Return to Demo Studio</Link>
          </aside>
        )}
        <a className="skip-link" href="#main">
          Skip to content
        </a>
        {children}
      </body>
    </html>
  );
}
