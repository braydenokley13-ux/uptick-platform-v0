export const dynamic = "force-dynamic";
import { Brand } from "@/components/ui";
import { LoginForm } from "@/components/forms";
import { localMode } from "@/lib/config";
export default async function Login({
  searchParams,
}: {
  searchParams: Promise<{ logout?: string; recovered?: string }>;
}) {
  const status = await searchParams;
  return (
    <main id="main" className="login-page">
      <section className="login-story">
        <Brand />
        <div>
          <p className="eyebrow">THE NEIGHBORHOOD IS YOUR ADVANTAGE</p>
          <h1>
            Find them.
            <br />
            Bring them in.
            <br />
            <em>Bring them back.</em>
          </h1>
          <p>
            A little something free.
            <br />A real reason to come around again.
          </p>
        </div>
        <span className="eyebrow">UPTICK GROWTH · LOCAL, ON PURPOSE.</span>
      </section>
      <section className="login-panel">
        <div>
          <p className="eyebrow">WELCOME TO UPTICK GROWTH</p>
          <h2>Good to have you back.</h2>
          <p className="muted">
            Your business. Your neighborhood. Your next move.
          </p>
          {status.logout === "local-revocation" && (
            <p role="status">
              This Uptick session is revoked. Provider logout could not be
              confirmed; contact your operator if you also need provider-session
              cleanup.
            </p>
          )}
          {status.recovered && (
            <p role="status">
              Your password was changed and existing Uptick sessions were
              revoked. Sign in with your new password.
              {status.recovered === "application-sessions-revoked"
                ? " Provider logout still needs confirmation by your operator."
                : ""}
            </p>
          )}
          <LoginForm local={localMode()} />
          <p className="fine">Need access? Contact your Uptick operator.</p>
        </div>
      </section>
    </main>
  );
}
