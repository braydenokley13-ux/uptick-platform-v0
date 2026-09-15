import { Brand } from "@/components/ui";
import { AccountRecovery } from "@/components/account-security";
export const dynamic = "force-dynamic";
export default async function RecoveryPage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string; sb_flow_id?: string }>;
}) {
  const query = await searchParams;
  return (
    <main
      id="main"
      className="page-content"
      style={{ maxWidth: 620, margin: "0 auto", padding: "32px 20px" }}
    >
      <Brand />
      <h1>Recover your business account</h1>
      <AccountRecovery
        code={typeof query.code === "string" ? query.code : undefined}
        flowId={
          typeof query.sb_flow_id === "string" ? query.sb_flow_id : undefined
        }
      />
    </main>
  );
}
