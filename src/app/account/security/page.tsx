import { Brand } from "@/components/ui";
import { AccountSecurity } from "@/components/account-security";
export const dynamic = "force-dynamic";
export default function SecurityPage() {
  return (
    <main
      id="main"
      className="page-content"
      style={{ maxWidth: 680, margin: "0 auto", padding: "32px 20px" }}
    >
      <Brand />
      <h1>Account security</h1>
      <AccountSecurity />
    </main>
  );
}
