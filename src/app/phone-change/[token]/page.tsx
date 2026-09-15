import Link from "next/link";
import { getDb } from "@/lib/db";
import { phoneCorrectionPreview } from "@/lib/member-phone-correction";
import { MemberFrame } from "@/components/member-ui";
import { ConfirmPhoneChange } from "@/components/phone-change";
export const dynamic = "force-dynamic";
export default async function PhoneChangePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  let change;
  try {
    change = await phoneCorrectionPreview(await getDb(), token);
  } catch {
    return (
      <MemberFrame>
        <div className="member-empty">
          <h1>This verification link is unavailable.</h1>
          <p>
            It may have expired or the change may already be complete. Ask
            Uptick support to review your request.
          </p>
          <Link href="/sms" className="button secondary">
            Contact Uptick support
          </Link>
        </div>
      </MemberFrame>
    );
  }
  return (
    <MemberFrame>
      <div className="member-empty">
        <p className="eyebrow">REQUESTED ACCOUNT CORRECTION</p>
        <h1>Verify your new number.</h1>
        <p>
          This verifies the number ending {change.phoneHint} for a phone change
          you requested through Uptick support. If you did not request a change,
          close this page and contact support.
        </p>
        {change.confirmed ? (
          <p role="status">
            Your verification is recorded. Support will complete the requested
            change.
          </p>
        ) : (
          <ConfirmPhoneChange credential={token} />
        )}
        <p>
          This verification does not sign you in or opt you into promotional
          texts.
        </p>
        <Link href="/sms">Contact Uptick support</Link>
      </div>
    </MemberFrame>
  );
}
