import Link from "next/link";
import { Brand } from "@/components/ui";
export default function NotFound() {
  return (
    <main id="main" className="policy-page">
      <Brand />
      <p className="eyebrow" style={{ marginTop: 45 }}>
        PAGE NOT FOUND
      </p>
      <h1>A little off the path.</h1>
      <p>
        This page isn’t available. Use the link in your Uptick text to open a
        private pass, or return to your workspace.
      </p>
      <Link className="button" href="/">
        Back to Uptick →
      </Link>
    </main>
  );
}
